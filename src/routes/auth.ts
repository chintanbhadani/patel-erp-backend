import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-fallback';

// Login User
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    // Find user by exact match or case-insensitive match
    let user = await prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          username: {
            equals: cleanUsername,
            mode: 'insensitive'
          }
        }
      });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      user: { id: user.id, username: user.username, role: user.role },
      token
    });
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Current User Profile
router.get('/me', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'QC_INSPECTOR', 'SALES_REP'), async (req, res) => {
  try {
    const userId = (req as any).user.id;
    
    // Dev fallback handling
    if (userId === 'dev-user') {
      return res.json({ id: 'dev-user', username: 'dev', role: 'PLANT_ADMIN' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update Current User Profile
router.put('/me', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'QC_INSPECTOR', 'SALES_REP'), async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { username, password } = req.body;

    if (userId === 'dev-user') {
      return res.json({ id: 'dev-user', username: username || 'dev', role: 'PLANT_ADMIN' });
    }

    const updateData: any = {};
    if (username) updateData.username = username;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, username: true, role: true }
    });

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
