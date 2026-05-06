require('dotenv').config();

const admin = require('firebase-admin');
let serviceAccount = null;
if (process.env.FIREBASE_CONFIG) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin SDK once
if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const bcrypt = require("bcrypt");   
const Employee = require("./models/Employee");

const Visitor = require('./models/Visitor');
const Admin = require('./models/Admin');
const ScheduledMeeting = require('./models/ScheduledMeeting');
const Settings = require('./models/Settings');
const cron = require('node-cron');
const { haversine } = require('./utils/haversine');

const app = express();


const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

// Employee Login API
app.post("/api/employees/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const employee = await Employee.findOne({ email: normalizedEmail });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const isMatch = await bcrypt.compare(password, employee.password);

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const emp = employee.toObject();
    delete emp.password;

    res.json({ employee: emp });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Server is running');
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Atlas Connected"))
  .catch(err => {
    console.error("MongoDB Error:", err.message);
    process.exit(1);
  });

// Configure Multer for local photo upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

const sendVisitorNotification = async (visitor, isScheduled = false) => {
  try {
    // Update notification timing fields before sending
    visitor.notificationStartTime = new Date();
    visitor.notificationActive = true;
    visitor.lastNotificationSentAt = new Date();
    await visitor.save();

    const employee = await Employee.findById(visitor.employeeId).select('expoPushToken name');
    console.log("🔔 Preparing notification for:", employee?.name);
    console.log("🎫 Using token:", employee?.expoPushToken ? (employee.expoPushToken.substring(0, 20) + '...') : 'NULL');

    if (!employee?.expoPushToken) {
      console.log('❌ No FCM device token found for employee');
      return;
    }

    console.log('📲 Sending FCM to token:', employee.expoPushToken.substring(0, 20) + '...');
    if (isScheduled) {
      console.log("Sending scheduled notification to:", visitor.employeeId);
    }

    const title = isScheduled 
      ? '📅 Scheduled Visitor Arrived'
      : (visitor.referredBy ? `🔄 REFERRED BY: ${visitor.referredBy.toUpperCase()}` : '🔔 New Visitor Request');
    
    const body = isScheduled
      ? `Your scheduled visitor ${visitor.name} has arrived.`
      : (visitor.referredBy 
          ? `IMPORTANT: Referred by ${visitor.referredBy}\n${visitor.name} is waiting for your approval.`
          : `${visitor.name} is waiting for your approval`);

    const message = {
      token: employee.expoPushToken,
      notification: {
        title: title,
        body: body,
      },
      data: {
        type: isScheduled ? 'scheduled_visitor' : 'visitor_request',
        visitorId: visitor._id.toString(),
        referredBy: visitor.referredBy || '',
        name: visitor.name,
        phone: visitor.phone,
        email: visitor.email || '',
        company: visitor.company || '',
        visitorDesignation: visitor.visitorDesignation || '',
        purpose: visitor.purpose,
        employeeId: visitor.employeeId.toString(),
        employeeName: visitor.employeeName || employee.name || '',
        department: visitor.department || '',
        employeeDesignation: visitor.employeeDesignation || '',
        photoUrl: visitor.photoUrl || '',
        visitDate: visitor.visitDate?.toString() || '',
        checkInTime: visitor.checkInTime?.toString() || '',
        status: visitor.status,
        place: visitor.place || '',
        visitorCount: (visitor.visitorCount || 1).toString(),
      },
      android: {
        priority: 'high',
        notification: {
          sound: isScheduled ? 'default' : 'notification',
          channelId: 'visitor-alerts-v9',
          priority: 'max',
          visibility: 'public',
          defaultVibrateTimings: !isScheduled,
          ...(isScheduled ? {} : { vibrateTimingsMillis: [0, 400, 300, 400, 300, 500] }),
        },
      },
    };

    console.log('📤 FCM Message payload:', JSON.stringify(message, null, 2));
    const response = await admin.messaging().send(message);
    console.log('✅ FCM message sent successfully:', response);

  } catch (error) {
    console.error('❌ FCM send error:', error.message);
  }
};

const updateVisitorStatus = async (visitorId, status, message = '') => {
  return Visitor.findByIdAndUpdate(
    visitorId,
    { 
      status, 
      message,
      notificationActive: false, // Deactivate notification when action is taken
      ...(status === 'approved' ? { meetingStartTime: new Date() } : {})
    },
    { new: true }
  );
};

// Meeting End endpoint
app.put('/api/visitors/:id/meeting-end', async (req, res) => {
  try {
    const body = req.body || {};
    const { referredTo } = body;
    const updateData = { meetingEndTime: new Date() };
    if (referredTo) updateData.referredTo = referredTo;

    const updatedVisitor = await Visitor.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    if (!updatedVisitor) {
      console.log('❌ Meeting end: Visitor not found', req.params.id);
      return res.status(404).json({ error: 'Visitor not found' });
    }
    res.json(updatedVisitor);
  } catch (err) {
    console.error('❌ Meeting end error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- SETTINGS ROUTES ---
app.get('/api/settings/geo-fence', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
      await settings.save();
    }
    res.json(settings.geoFence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/geo-fence', async (req, res) => {
  try {
    const { latitude, longitude, radius } = req.body;
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.geoFence = { latitude, longitude, radius };
    await settings.save();
    res.json(settings.geoFence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUTH ROUTES ---

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const admin = await Admin.findOne({ email: normalizedEmail });

    if (!admin || !admin.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ message: 'Login successful', admin: { email: admin.email } });
  } catch (err) {
    console.error('Admin Login Error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});


// --- EMPLOYEE MANAGEMENT ROUTES ---

app.get('/api/employees', async (req, res) => {
  try {
    const employees = await Employee.find().select('-password -expoPushToken');
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', upload.single('photo'), async (req, res) => {
  try {
    const { name, email, password, department, designation } = req.body;
    const photo = req.file ? `/uploads/${req.file.filename}` : '';
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newEmployee = new Employee({
      name, email, password: hashedPassword, department, designation, photo
    });
    await newEmployee.save();

    const employeeResponse = newEmployee.toObject();
    delete employeeResponse.password;

    res.status(201).json(employeeResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/employees/:id', upload.single('photo'), async (req, res) => {
  try {
    const { name, email, department, designation, password } = req.body;
    const updateData = { name, email, department, designation };
    
    if (req.file) {
      updateData.photo = `/uploads/${req.file.filename}`;
    }
    
    if (password && password.trim() !== "") {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/employees/:id/push-token', async (req, res) => {
  try {
    const { expoPushToken = '' } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { expoPushToken },
      { new: true }
    ).select('-password -expoPushToken');

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await Employee.findByIdAndDelete(req.params.id);
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// --- Scheduled Meeting APIs ---

app.post('/api/schedule-meeting', async (req, res) => {
  try {
    const meeting = new ScheduledMeeting(req.body);
    await meeting.save();
    res.status(201).json(meeting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule-meeting/employee/:employeeId', async (req, res) => {
  try {
    const meetings = await ScheduledMeeting.find({ 
      employeeId: req.params.employeeId,
      status: 'scheduled'
    }).sort({ scheduledDate: 1, startTime: 1 });
    res.json(meetings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule-meeting/check/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    console.log("🔍 Checking meeting for phone:", phone);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find a meeting for today with this phone number
    const meeting = await ScheduledMeeting.findOne({
      phone,
      status: 'scheduled',
      scheduledDate: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (!meeting) {
      console.log("❌ No scheduled meeting found for phone:", phone, "on date:", today);
      return res.status(404).json({ message: 'No scheduled meeting found' });
    }
    console.log("📌 Found meeting for:", meeting.visitorName);
    const now = new Date();
    const currentTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    console.log("⏰ Current Time:", currentTimeStr);
    console.log("📅 Meeting Range:", meeting.startTime, "to", meeting.endTime);

    // Convert time "HH:mm" to minutes from midnight for robust comparison
    const toMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    const currentMins = toMinutes(currentTimeStr);
    let startMins = toMinutes(meeting.startTime);
    let endMins = toMinutes(meeting.endTime);

    // Add 30 minutes grace period
    startMins -= 30;
    endMins += 30;

    // Handle wrap-around (if meeting is around midnight)
    let isTimeMatch = false;
    if (startMins <= endMins) {
      // Normal case: 10:00 to 12:00
      isTimeMatch = (currentMins >= startMins && currentMins <= endMins);
    } else {
      // Wrap around case: 23:00 to 01:00
      isTimeMatch = (currentMins >= startMins || currentMins <= endMins);
    }

    if (isTimeMatch) {
      console.log("✅ Time match (with grace period)! Auto-approving...");
      
      // Create Visitor record
      const newVisitor = new Visitor({
        name: meeting.visitorName,
        phone: meeting.phone,
        email: meeting.email,
        company: meeting.company,
        visitorDesignation: meeting.visitorDesignation,
        purpose: meeting.purpose,
        employeeId: meeting.employeeId,
        employeeName: meeting.employeeName,
        department: meeting.department,
        employeeDesignation: meeting.employeeDesignation,
        status: 'approved',
        message: 'Welcome, your meeting is scheduled',
        visitDate: new Date(),
        checkInTime: new Date(),
        meetingStartTime: new Date()
      });

      await newVisitor.save();

      // Update meeting status
      meeting.status = 'completed';
      await meeting.save();

      // Send Silent Notification
      await sendVisitorNotification(newVisitor, true);

      return res.json({ 
        autoApproved: true, 
        visitor: newVisitor 
      });
    } else {
      return res.status(403).json({ 
        message: 'Meeting exists but outside time range',
        meeting
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- End Scheduled Meeting APIs ---

// --- VISITOR ROUTES ---

// Create new visit
app.post('/api/visitors', upload.single('photo'), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      company,
      visitorDesignation,
      purpose,
      employeeId,
      employeeName,
      department,
      employeeDesignation,
      place,
      visitorCount,
      referredBy,
      checkInLocation
    } = req.body;
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : '';

    let parsedLocation = null;
    let distance = null;
    let isInside = true;
    
    if (checkInLocation) {
      try {
        parsedLocation = JSON.parse(checkInLocation);
        const settings = await Settings.findOne();
        if (settings && settings.geoFence && settings.geoFence.radius > 0) {
           distance = haversine(
             parsedLocation.lat, parsedLocation.lng,
             settings.geoFence.latitude, settings.geoFence.longitude
           );
           if (distance > settings.geoFence.radius + 50) {
             return res.status(403).json({ error: `You are not within the office premises (${distance.toFixed(0)}m from center). Entry not allowed.` });
           }
        }
      } catch (e) {
        console.error("Location parse error", e);
      }
    }

    const newVisitor = new Visitor({
      name,
      phone,
      email,
      company,
      visitorDesignation,
      purpose,
      employeeId,
      employeeName,
      department,
      employeeDesignation,
      photoUrl,
      place,
      visitorCount: parseInt(visitorCount) || 1,
      visitDate: new Date(),
      referredBy: referredBy || '',
      checkInLocation: parsedLocation,
      lastLocationUpdate: parsedLocation ? new Date() : null,
      distanceFromOffice: distance,
      isInsideGeofence: isInside
    });
    await newVisitor.save();
    await sendVisitorNotification(newVisitor);
    res.status(201).json(newVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all visitors (Admin)
app.get('/api/visitors', async (req, res) => {
  try {
    const visitors = await Visitor.find().populate('employeeId', 'name department designation').sort({ checkInTime: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active visitors
app.get('/api/visitors/active', async (req, res) => {
  try {
    const visitors = await Visitor.find({ checkOutTime: null }).populate('employeeId', 'name').sort({ checkInTime: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get visitors for a specific employee ID
app.get('/api/visitors/employee/:employeeId', async (req, res) => {
  try {
    const visitors = await Visitor.find({
      employeeId: req.params.employeeId
    }).populate('employeeId', 'name department designation').sort({ checkInTime: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get visitor by ID
app.get('/api/visitors/:id', async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id).populate('employeeId', 'name department designation');
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    res.json(visitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update location background tracking
app.put('/api/visitors/:id/location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor || visitor.checkOutTime) {
      return res.status(400).json({ error: 'Invalid visitor session' });
    }

    visitor.lastLocationUpdate = new Date();
    visitor.checkOutLocation = { lat, lng };

    const settings = await Settings.findOne();
    if (settings && settings.geoFence && settings.geoFence.radius > 0) {
      const distance = haversine(lat, lng, settings.geoFence.latitude, settings.geoFence.longitude);
      visitor.distanceFromOffice = distance;
      
      const radiusWithBuffer = settings.geoFence.radius + 50; // Add 50m buffer tolerance

      console.log(`[GEO-DEBUG] Visitor: ${visitor.name}`);
      console.log(`[GEO-DEBUG] Coords: Admin(${settings.geoFence.latitude}, ${settings.geoFence.longitude}) | Visitor(${lat}, ${lng})`);
      console.log(`[GEO-DEBUG] Distance: ${distance.toFixed(2)}m | Allowed: ${radiusWithBuffer}m (Radius: ${settings.geoFence.radius}m + 50m Buffer)`);

      if (distance > radiusWithBuffer) {
        visitor.consecutiveOutsideCount = (visitor.consecutiveOutsideCount || 0) + 1;
        console.log(`[GEO-DEBUG] Status: OUTSIDE | Consecutive Count: ${visitor.consecutiveOutsideCount}/3`);
        
        if (visitor.consecutiveOutsideCount >= 3) {
          visitor.isInsideGeofence = false;
          visitor.checkOutTime = new Date();
          visitor.isAutoCheckout = true;
          visitor.checkoutReason = 'geo_exit';
          visitor.status = 'completed';
          if (!visitor.meetingEndTime) visitor.meetingEndTime = new Date();
          visitor.message = `Auto-checkout: Consistently outside premises (${distance.toFixed(1)}m > ${radiusWithBuffer}m).`;
          console.log(`[GEO-ACTION] !!! AUTO CHECKOUT !!! Visitor ${visitor.name} exited premises.`);
        }
      } else {
        visitor.consecutiveOutsideCount = 0; // Reset counter if back inside
        visitor.isInsideGeofence = true;
        console.log(`[GEO-DEBUG] Status: INSIDE | Counter Reset.`);
      }
    }

    await visitor.save();
    res.json({ success: true, isInsideGeofence: visitor.isInsideGeofence, distance: visitor.distanceFromOffice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update visitor status (Approve/Reject + Message)
app.put('/api/visitors/:id', async (req, res) => {
  try {
    const { status, message } = req.body;
    const updatedVisitor = await updateVisitorStatus(req.params.id, status, message);
    res.json(updatedVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/visitors/:id/approve', async (req, res) => {
  try {
    const updatedVisitor = await updateVisitorStatus(req.params.id, 'approved', req.body.message || '');
    res.json(updatedVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/visitors/:id/reject', async (req, res) => {
  try {
    const updatedVisitor = await updateVisitorStatus(req.params.id, 'rejected', req.body.message || '');
    res.json(updatedVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ask to Wait endpoint
app.put('/api/visitors/:id/wait', async (req, res) => {
  try {
    const { waitTime } = req.body;
    const updatedVisitor = await Visitor.findByIdAndUpdate(
      req.params.id,
      {
        waitTime,
        waitStartTime: new Date(),
        isWaiting: true,
        notificationActive: false
      },
      { new: true }
    );
    if (!updatedVisitor) return res.status(404).json({ error: 'Visitor not found' });
    res.json(updatedVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend notification for an existing visitor
app.post('/api/visitors/:id/resend', async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    console.log("🔄 Resend requested for Visitor:", visitor?.name || req.params.id);

    if (!visitor) {
      console.log("❌ Resend failed: Visitor not found");
      return res.status(404).json({ error: 'Visitor not found' });
    }
    
    // Only allow resending if status is still pending
    if (visitor.status !== 'pending') {
      console.log("❌ Resend failed: Status is", visitor.status);
      return res.status(400).json({ error: `Cannot resend. Current status is: ${visitor.status}` });
    }

    // Reset fields to allow a fresh notification flow
    visitor.notificationActive = true;
    visitor.notificationStartTime = new Date();
    visitor.isWaiting = false;
    visitor.waitTime = null;
    visitor.waitStartTime = null;

    // Re-trigger the notification
    console.log("🔔 Re-sending notification to employee:", visitor.employeeId);
    await sendVisitorNotification(visitor);
    
    await visitor.save();
    console.log("✅ Resend logic completed successfully");

    res.json({ success: true, message: "Notification resent successfully" });
  } catch (err) {
    console.error('❌ Resend Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Check for active visit by phone number (Same Day Strict)
app.get('/api/visitors/check/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    
    // Define strict start and end of current day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Find latest active visitor with this phone number within today's range
    const activeVisitor = await Visitor.findOne({ 
      phone, 
      checkOutTime: null,
      visitDate: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ checkInTime: -1 }); // Sort by check-in time DESC to get the absolute latest

    if (!activeVisitor) {
      return res.status(404).json({ message: 'No active session found for today' });
    }

    res.json(activeVisitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exit System
app.post('/api/visitors/exit', async (req, res) => {
  try {
    const { phone } = req.body;
    // Find active visitor with this phone number
    const activeVisitor = await Visitor.findOne({ phone, checkOutTime: null }).sort({ checkInTime: -1 });

    if (!activeVisitor) {
      return res.status(404).json({ message: 'No active visit found for this phone number' });
    }

    activeVisitor.checkOutTime = new Date();
    activeVisitor.status = 'completed';
    // Safety: If meeting end was not clicked, set it to check-out time
    if (!activeVisitor.meetingEndTime) {
      activeVisitor.meetingEndTime = activeVisitor.checkOutTime;
    }
    await activeVisitor.save();

    res.json({ message: 'Exit successful', visitor: activeVisitor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Delete visitor log (Admin only)
app.delete('/api/visitors/:id', async (req, res) => {
  try {
    const deleted = await Visitor.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Visitor not found' });
    res.json({ message: 'Visitor record deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CRON JOBS ---
// Fallback for location stopping (check every minute)
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    // Check for 10-minute fallback
    const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const staleVisitors = await Visitor.find({
      checkOutTime: null,
      lastLocationUpdate: { $ne: null, $lt: tenMinsAgo }
    });

    for (let visitor of staleVisitors) {
      visitor.checkOutTime = new Date();
      visitor.status = 'completed';
      visitor.isAutoCheckout = true;
      visitor.checkoutReason = 'location_off';
      visitor.message = "Location tracking stopped. System auto-marked checkout.";
      if (!visitor.meetingEndTime) visitor.meetingEndTime = new Date();
      await visitor.save();
      console.log(`Auto checked out visitor ${visitor.name} due to stale location.`);
    }
  } catch (err) {
    console.error("Cron 10-min fallback error:", err);
  }
});

// 8:00 PM auto-checkout
cron.schedule('0 20 * * *', async () => {
  try {
    const activeVisitors = await Visitor.find({ checkOutTime: null });
    for (let visitor of activeVisitors) {
      visitor.checkOutTime = new Date();
      visitor.status = 'completed';
      visitor.isAutoCheckout = true;
      visitor.checkoutReason = 'location_off';
      visitor.message = "Visitor did not complete checkout and location tracking was unavailable. System auto-marked checkout at 8:00 PM.";
      if (!visitor.meetingEndTime) visitor.meetingEndTime = new Date();
      await visitor.save();
      console.log(`8:00 PM Auto checked out visitor ${visitor.name}.`);
    }
  } catch (err) {
    console.error("Cron 8 PM fallback error:", err);
  }
}, {
  timezone: "Asia/Kolkata"
});

app.listen(PORT, '0.0.0.0', () => {

  console.log(`Server running on port ${PORT}`);
});
