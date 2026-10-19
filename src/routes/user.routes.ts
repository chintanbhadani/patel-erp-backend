import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { userRoles as INITIAL_USERS } from '../db/seederMasters';

const router = Router();
const prisma = new PrismaClient();

// Memory store fallback
let sampleUsers: any[] = [];

async function ensureSeedUsers() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    for (const u of INITIAL_USERS) {
      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { username: u.username },
            { employeeId: u.employeeId }
          ]
        }
      });
      if (!existing) {
        await prisma.user.create({
          data: {
            employeeId: u.employeeId,
            username: u.username,
            fullName: u.fullName,
            email: u.email,
            contactNumber: u.contactNumber,
            password: hashedPassword,
            role: u.role,
            status: u.status,
            isBlock: u.isBlock
          }
        });
      }
    }
  } catch (err) {
    console.error('Error seeding initial users in Prisma DB:', err);
  }
  if (sampleUsers.length === 0) {
    sampleUsers = INITIAL_USERS.map(u => ({
      ...u,
      id: String(u.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }
}

// GET /api/users
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureSeedUsers();
    const { search, role, status } = req.query;

    let dbUsers: any[] = [];
    try {
      dbUsers = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          employeeId: true,
          username: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNumber: true,
          role: true,
          status: true,
          isBlock: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (e) {
      dbUsers = [];
    }

    // Merge DB & memory sample users by id or username
    const map = new Map<string, any>();
    dbUsers.forEach(u => map.set(u.username, u));
    sampleUsers.forEach(u => {
      if (!map.has(u.username)) map.set(u.username, u);
    });

    let result = Array.from(map.values());

    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter(u =>
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.employeeId && u.employeeId.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.role && u.role.toLowerCase().includes(q))
      );
    }

    if (role) {
      result = result.filter(u => u.role === role);
    }

    if (status) {
      result = result.filter(u => u.status === status);
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let user: any = null;
    try {
      user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          employeeId: true,
          username: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNumber: true,
          role: true,
          status: true,
          isBlock: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (e) {
      user = null;
    }

    if (!user) {
      user = sampleUsers.find(u => u.id === id || u.username === id);
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/users
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      employeeId,
      username,
      fullName,
      firstName,
      lastName,
      email,
      contactNumber,
      password,
      role,
      status,
      isBlock
    } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const rawPassword = password || 'user123';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const userRole = Array.isArray(role) ? role.join(', ') : (role || 'Admin');

    let newUser: any = null;
    try {
      newUser = await prisma.user.create({
        data: {
          employeeId: employeeId || `E00${Math.floor(1000 + Math.random() * 9000)}`,
          username,
          fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim() || username,
          firstName: firstName || '',
          lastName: lastName || '',
          email: email || '',
          contactNumber: contactNumber || '',
          password: hashedPassword,
          role: userRole,
          status: status || 'Active',
          isBlock: isBlock ?? false
        },
        select: {
          id: true,
          employeeId: true,
          username: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNumber: true,
          role: true,
          status: true,
          isBlock: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (err) {
      console.warn('DB User create failed, using memory store:', err);
      newUser = {
        id: `usr-${Date.now()}`,
        employeeId: employeeId || `E00${Math.floor(10 + Math.random() * 90)}`,
        username,
        fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim() || username,
        firstName,
        lastName,
        email,
        contactNumber,
        role: userRole,
        status: status || 'Active',
        isBlock: isBlock ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      sampleUsers.unshift(newUser);
    }

    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      username,
      fullName,
      firstName,
      lastName,
      email,
      contactNumber,
      password,
      role,
      status,
      isBlock
    } = req.body;

    const userRole = Array.isArray(role) ? role.join(', ') : role;

    let updatedUser: any = null;

    // 1. Find user in Prisma database by id, username, or employeeId
    let existingUser = await prisma.user.findUnique({ where: { id } }).catch(() => null);
    if (!existingUser) {
      existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id },
            { username: id },
            { employeeId: id }
          ]
        }
      }).catch(() => null);
    }

    const updateData: any = {};
    if (employeeId !== undefined) updateData.employeeId = employeeId;
    if (username !== undefined) updateData.username = username;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (contactNumber !== undefined) updateData.contactNumber = contactNumber;
    if (userRole !== undefined) updateData.role = userRole;
    if (status !== undefined) updateData.status = status;
    if (isBlock !== undefined) updateData.isBlock = isBlock;

    // Always securely bcrypt hash the password if provided
    if (password && String(password).trim()) {
      const cleanPass = String(password).trim();
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(cleanPass, salt);
      console.log(`[User Security] Securely hashed and stored password in DB for user ${username || id}`);
    }

    if (existingUser) {
      updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
        select: {
          id: true,
          employeeId: true,
          username: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNumber: true,
          role: true,
          status: true,
          isBlock: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } else {
      // If user was not yet in Prisma, create directly in Prisma DB with hashed password
      const defaultPass = (password && String(password).trim()) || 'admin123';
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(defaultPass, salt);

      try {
        updatedUser = await prisma.user.create({
          data: {
            employeeId: employeeId || `E00${Math.floor(1000 + Math.random() * 9000)}`,
            username: username || id,
            fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim() || username || id,
            firstName: firstName || '',
            lastName: lastName || '',
            email: email || '',
            contactNumber: contactNumber || '',
            password: hashedPassword,
            role: userRole || 'Admin',
            status: status || 'Active',
            isBlock: Boolean(isBlock)
          },
          select: {
            id: true,
            employeeId: true,
            username: true,
            fullName: true,
            firstName: true,
            lastName: true,
            email: true,
            contactNumber: true,
            role: true,
            status: true,
            isBlock: true,
            createdAt: true,
            updatedAt: true
          }
        });
      } catch (createErr) {
        console.warn('Prisma create user on update fallback failed:', createErr);
      }
    }

    // Sync memory store
    const idx = sampleUsers.findIndex(u => u.id === id || u.username === id || (existingUser && u.id === existingUser.id));
    if (idx !== -1) {
      sampleUsers[idx] = {
        ...sampleUsers[idx],
        ...(employeeId && { employeeId }),
        ...(username && { username }),
        ...(fullName && { fullName }),
        ...(email && { email }),
        ...(contactNumber && { contactNumber }),
        ...(userRole && { role: userRole }),
        ...(status && { status }),
        ...(isBlock !== undefined && { isBlock }),
        updatedAt: new Date().toISOString()
      };
      if (!updatedUser) updatedUser = sampleUsers[idx];
    }

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// POST /api/users/:id/change-password
router.post('/:id/change-password', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newPassword, password } = req.body;
    const pass = newPassword || password;

    if (!pass || String(pass).trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const cleanPass = String(pass).trim();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(cleanPass, salt);

    let targetUser = await prisma.user.findFirst({
      where: {
        OR: [{ id }, { username: id }, { employeeId: id }]
      }
    });

    if (targetUser) {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { password: hashedPassword }
      });
      console.log(`[User Security] Password explicitly changed and hashed in DB for ${targetUser.username} (${targetUser.id})`);
      return res.json({ success: true, message: `Password for ${targetUser.username} successfully updated and hashed in database.` });
    }

    res.status(404).json({ error: 'User not found' });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: error.message || 'Failed to change password' });
  }
});

// PATCH /api/users/:id/toggle-block
router.patch('/:id/toggle-block', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let targetUser = await prisma.user.findUnique({ where: { id } });

    if (targetUser) {
      const updated = await prisma.user.update({
        where: { id },
        data: { isBlock: !targetUser.isBlock }
      });
      return res.json({ id: updated.id, isBlock: updated.isBlock });
    }

    const idx = sampleUsers.findIndex(u => u.id === id || u.username === id);
    if (idx !== -1) {
      sampleUsers[idx].isBlock = !sampleUsers[idx].isBlock;
      return res.json({ id: sampleUsers[idx].id, isBlock: sampleUsers[idx].isBlock });
    }

    res.status(404).json({ error: 'User not found' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle block status' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    try {
      await prisma.user.delete({ where: { id } });
    } catch (e) {
      sampleUsers = sampleUsers.filter(u => u.id !== id && u.username !== id);
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
