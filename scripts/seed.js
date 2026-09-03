import connectDB from "../src/modal/index.js";
import User from "../src/modal/user.js";
import bcrypt from "bcrypt";

const seedUsers = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        // Clear existing users if you want to start fresh (optional)
        await User.deleteMany({});
        console.log("🧹 Cleared existing users.");

        // Hash the password for the mock users
        const hashedPassword = await bcrypt.hash("password123", 10);

        const usersToInsert = [
            {
                name: "Chintan Bhadani",
                email: "chintan@example.com",
                password: hashedPassword,
                role: "admin",
                isVerified: true
            },
            {
                name: "Test Seller",
                email: "seller@test.com",
                password: hashedPassword
            }
        ];

        // Insert into the database
        await User.insertMany(usersToInsert);
        console.log("✅ Users seeded successfully!");

        // Exit process after seeding
        process.exit(0);
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seedUsers();
