const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  department: { type: String, required: true },
  designation: { type: String, required: true },
  photo: { type: String, default: '' },
  expoPushToken: { type: String, default: '' },
});

module.exports = mongoose.model('Employee', employeeSchema);
