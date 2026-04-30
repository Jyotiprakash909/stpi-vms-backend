require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // index.js currently uses bcryptjs
const Admin = require('./models/Admin');

const updateAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected...");

    let admin = await Admin.findOne({ email: 'admin@stpi.in' });
    
    if (!admin) {
      console.log("Admin not found, creating one...");
      admin = new Admin({ email: 'admin@stpi.in' });
    }

    const hashedPassword = await bcrypt.hash('123456', 10);
    admin.password = hashedPassword;
    await admin.save();

    console.log("Admin password updated successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Error updating admin:", err);
    process.exit(1);
  }
};

updateAdmin();
