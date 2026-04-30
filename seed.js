require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Employee = require('./models/Employee');
const Admin = require('./models/Admin');
const Visitor = require('./models/Visitor'); // Clear old visitors to avoid schema conflict

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected for seeding...");

    // Clear existing data
    await Employee.deleteMany({});
    await Admin.deleteMany({});
    await Visitor.deleteMany({});
    
    // Create Admin
    const adminHashedPassword = await bcrypt.hash('123456', 10);
    const newAdmin = new Admin({
      email: 'admin@stpi.in',
      password: adminHashedPassword
    });
    await newAdmin.save();
    console.log("Admin seeded.");

    // Create Employees
    const employeeHashedPassword = await bcrypt.hash('password123', 10);
    const employees = [
      { name: "Amit Sharma", email: "amit.sharma@stpi.in", password: employeeHashedPassword, department: "HR", designation: "HR Manager" },
      { name: "Priya Singh", email: "priya.singh@stpi.in", password: employeeHashedPassword, department: "IT", designation: "Software Engineer" },
      { name: "Rahul Verma", email: "rahul.verma@stpi.in", password: employeeHashedPassword, department: "Admin", designation: "Facility Manager" },
      { name: "Neha Gupta", email: "neha.gupta@stpi.in", password: employeeHashedPassword, department: "Finance", designation: "Accountant" },
      { name: "Arjun Mehta", email: "arjun.mehta@stpi.in", password: employeeHashedPassword, department: "Operations", designation: "Operations Lead" }
    ];

    await Employee.insertMany(employees);
    console.log("Employees seeded successfully! Password for all is 'password123'");
    
    process.exit(0);
  } catch (err) {
    console.error("Error seeding data:", err);
    process.exit(1);
  }
};

seedDatabase();
