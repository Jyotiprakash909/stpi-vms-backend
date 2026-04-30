const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' },
  company: { type: String, default: '' },
  visitorDesignation: { type: String, default: '' },
  purpose: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, default: '' },
  department: { type: String, default: '' },
  employeeDesignation: { type: String, default: '' },
  place: { type: String, default: '' },
  visitorCount: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'], default: 'pending' },
  message: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  visitDate: { type: Date, default: Date.now },
  checkInTime: { type: Date, default: Date.now },
  checkOutTime: { type: Date, default: null },
  // Notification control fields
  notificationStartTime: { type: Date, default: null },
  notificationActive: { type: Boolean, default: false },
  lastNotificationSentAt: { type: Date, default: null },
  // Ask to Wait fields
  waitTime: { type: Number, default: null },
  waitStartTime: { type: Date, default: null },
  isWaiting: { type: Boolean, default: false },
  // Meeting Time Tracking
  meetingStartTime: { type: Date, default: null },
  meetingEndTime: { type: Date, default: null },
  // Referral System
  referredBy: { type: String, default: '' },
  referredTo: { type: String, default: '' }, // For tracking where someone was referred to
  // Geo-Fencing & Location Tracking
  checkInLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  checkOutLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  lastLocationUpdate: { type: Date, default: null },
  isAutoCheckout: { type: Boolean, default: false },
  checkoutReason: { type: String, enum: ['manual', 'geo_exit', 'location_off'], default: 'manual' },
  // Debugging & Status
  distanceFromOffice: { type: Number, default: null },
  isInsideGeofence: { type: Boolean, default: true }
});

module.exports = mongoose.model('Visitor', visitorSchema);
