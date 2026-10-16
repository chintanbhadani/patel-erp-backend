import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-fallback';

// Login User with Google Authenticator 2FA
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

    // Check if user already has 2FA enabled
    if (user.isTwoFactorEnabled && user.twoFactorSecret) {
      const tempToken = jwt.sign(
        { id: user.id, username: user.username, purpose: '2FA_VERIFY' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );

      return res.json({
        requires2FA: true,
        isSetup: false,
        tempToken,
        message: 'Please enter the 6-digit code from Google Authenticator'
      });
    }

    // First time login / 2FA not yet enabled -> Setup Google Authenticator
    const secret = generateSecret();
    const uri = generateURI({
      issuer: 'Patel Strap ERP',
      label: user.username,
      secret
    });
    const qrCode = await QRCode.toDataURL(uri);

    const tempToken = jwt.sign(
      { id: user.id, username: user.username, tempSecret: secret, purpose: '2FA_SETUP' },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    return res.json({
      requires2FA: true,
      isSetup: true,
      qrCode,
      secret,
      tempToken,
      message: 'Scan this QR code with Google Authenticator to enable 2FA'
    });
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Google Authenticator 2FA code & issue auth token
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Verification code and session are required' });
    }

    const cleanCode = String(code).trim().replace(/\s+/g, '');
    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: 'Code must be a 6-digit number' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (decoded.purpose === '2FA_SETUP') {
      const result = verifySync({ token: cleanCode, secret: decoded.tempSecret });
      if (!result?.valid) {
        return res.status(400).json({ error: 'Invalid Google Authenticator code. Please check and try again.' });
      }

      // Save secret and enable 2FA permanently for this user
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: decoded.tempSecret,
          isTwoFactorEnabled: true
        }
      });
    } else if (decoded.purpose === '2FA_VERIFY') {
      if (!user.twoFactorSecret) {
        return res.status(400).json({ error: '2FA is not properly configured. Please contact administrator.' });
      }

      const result = verifySync({ token: cleanCode, secret: user.twoFactorSecret });
      if (!result?.valid) {
        return res.status(400).json({ error: 'Invalid Google Authenticator code. Please check and try again.' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    // Success -> generate permanent session token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      user: { id: user.id, username: user.username, role: user.role },
      token,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('2FA verification route error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Admin reset 2FA for a user
router.post('/reset-2fa/:userId', authorizeRole('PLANT_ADMIN', 'SHIFT_SUPERVISOR', 'Admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        isTwoFactorEnabled: false
      }
    });
    res.json({ message: '2FA has been reset. User will be prompted to scan a new QR code on next login.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset 2FA' });
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
