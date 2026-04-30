const mongoose = require('mongoose');

const scheduledMeetingSchema = new mongoose.Schema({
  visitorName: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' },
  company: { type: String, default: '' },
  visitorDesignation: { type: String, default: '' },
  purpose: { type: String, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true },
  department: { type: String, required: true },
  employeeDesignation: { type: String, required: true },
  scheduledDate: { type: Date, required: true },
  startTime: { type: String, required: true }, // Format "HH:mm"
  endTime: { type: String, required: true },   // Format "HH:mm"
  status: { type: String, enum: ['scheduled', 'completed', 'expired'], default: 'scheduled' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScheduledMeeting', scheduledMeetingSchema);
