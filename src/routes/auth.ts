import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import { getUserMetadata, setUserMetadata } from '../services/userMetadataStore';

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

    if (user.isBlock) {
      return res.status(403).json({ error: 'Account is blocked. Please contact system administrator.' });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check 2FA requirement
    const meta = getUserMetadata(user.id);
    const usernameMeta = getUserMetadata(user.username);
    const twoFactorEnabled = meta.twoFactorEnabled !== undefined ? meta.twoFactorEnabled : (usernameMeta.twoFactorEnabled ?? true);
    const existingSecret = meta.twoFactorSecret || usernameMeta.twoFactorSecret;

    if (twoFactorEnabled) {
      if (!existingSecret) {
        // First-time setup OR 2FA was reset by admin: present QR code
        const secret = generateSecret();
        const uri = generateURI({
          secret,
          label: user.username,
          issuer: 'Patel Strap ERP'
        });
        const qrCodeUrl = await qrcode.toDataURL(uri);

        const tempToken = jwt.sign(
          {
            id: user.id,
            username: user.username,
            role: user.role,
            tempSecret: secret,
            isSetup: true
          },
          JWT_SECRET,
          { expiresIn: '10m' }
        );

        return res.json({
          requires2FA: true,
          isSetup: true,
          tempToken,
          qrCode: qrCodeUrl,
          secret,
          message: 'Please scan the QR code with Google Authenticator and enter the 6-digit code.'
        });
      } else {
        // 2FA is already configured: prompt for 6-digit code
        const tempToken = jwt.sign(
          {
            id: user.id,
            username: user.username,
            role: user.role,
            isSetup: false
          },
          JWT_SECRET,
          { expiresIn: '10m' }
        );

        return res.json({
          requires2FA: true,
          isSetup: false,
          tempToken,
          message: 'Enter the 6-digit verification code from Google Authenticator.'
        });
      }
    }

    // 2FA is disabled for this user: sign in directly
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

// Verify 2FA TOTP Code & Complete Login
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Verification token and 6-digit code are required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ error: '2FA session expired. Please enter username and password again.' });
    }

    const cleanCode = String(code).trim().replace(/\s+/g, '');
    if (cleanCode.length !== 6) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit numeric code' });
    }

    let isValid = false;

    if (decoded.isSetup && decoded.tempSecret) {
      // Verifying first-time QR scan setup
      const result = verifySync({
        secret: decoded.tempSecret,
        token: cleanCode
      });
      isValid = Boolean(result && result.valid);

      if (isValid) {
        // Permanently persist secret for user
        setUserMetadata(decoded.id, {
          twoFactorSecret: decoded.tempSecret,
          twoFactorEnabled: true,
          isTwoFactorSetup: true
        }, decoded.username);
      }
    } else {
      // Verifying against saved secret
      const meta = getUserMetadata(decoded.id);
      const secret = meta.twoFactorSecret || getUserMetadata(decoded.username).twoFactorSecret;
      
      if (!secret) {
        return res.status(400).json({ error: '2FA configuration not found. Please log in again to set up.' });
      }

      const result = verifySync({
        secret,
        token: cleanCode
      });
      isValid = Boolean(result && result.valid);
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid Google Authenticator code. Please check your app and try again.' });
    }

    // Code is valid! Sign final JWT
    const token = jwt.sign(
      { id: decoded.id, username: decoded.username, role: decoded.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      user: { id: decoded.id, username: decoded.username, role: decoded.role },
      token
    });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA code' });
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
