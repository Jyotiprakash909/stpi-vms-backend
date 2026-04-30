const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  geoFence: {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    radius: { type: Number, default: 100 } // in meters
  }
});

module.exports = mongoose.model('Settings', settingsSchema);
