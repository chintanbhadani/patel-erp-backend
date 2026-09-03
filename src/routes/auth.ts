import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-fallback';

// Login User
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user (ignoring password hash for simplicity in this MVP)
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user || user.password !== password) {
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
    if (password) updateData.password = password;

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
