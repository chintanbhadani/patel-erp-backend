import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const DEFAULT_DESCRIPTIONS = [
  'BODA',
  'VISITING CARD',
  'OFFLOADING',
  'INTERNET RECHARGE',
  'CEMENT OFFLOADING',
  'UNBS WEING SCAL',
  'YAKA',
  'LUNCH',
  'TIN NUMBER',
  'TRANSPORT',
  'CEMENT TRANSPORT',
  'CEMENT LOADING',
  'FUEL',
  'KAVERA',
  'BANER PRINTING',
  'DELEVARY NOTE',
  'AIRTIME'
];

// GET all expenses
router.get('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { search, startDate, endDate } = req.query;

    const where: any = {};
    if (search) {
      where.description = {
        contains: String(search),
        mode: 'insensitive',
      };
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(String(startDate));
      if (endDate) where.date.lte = new Date(String(endDate));
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// GET expense descriptions autocomplete options
router.get('/descriptions', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const masterItems = await prisma.expenseMaster.findMany({
      orderBy: { description: 'asc' },
    });

    const distinctExpenses = await prisma.expense.findMany({
      select: { description: true },
      distinct: ['description'],
    });

    const set = new Set<string>();
    DEFAULT_DESCRIPTIONS.forEach(d => set.add(d.trim()));
    masterItems.forEach(m => set.add(m.description.trim()));
    distinctExpenses.forEach(e => {
      if (e.description) set.add(e.description.trim());
    });

    const result = Array.from(set).sort().map(desc => ({
      id: desc,
      description: desc,
      name: desc,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching expense descriptions:', error);
    res.status(500).json({ error: 'Failed to fetch expense descriptions' });
  }
});

// POST add new description to ExpenseMaster
router.post('/descriptions', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const cleanDesc = description.trim();
    const existing = await prisma.expenseMaster.findUnique({
      where: { description: cleanDesc },
    });

    if (existing) {
      return res.json({ id: existing.description, description: existing.description, name: existing.description });
    }

    const created = await prisma.expenseMaster.create({
      data: { description: cleanDesc },
    });

    res.status(201).json({ id: created.description, description: created.description, name: created.description });
  } catch (error) {
    console.error('Error creating expense description:', error);
    res.status(500).json({ error: 'Failed to create expense description' });
  }
});

// POST new expense
router.post('/', authorizeRole('PLANT_ADMIN', 'SALES_REP', 'SHIFT_SUPERVISOR'), async (req: Request, res: Response) => {
  try {
    const { date, description, amount, notes } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const cleanDesc = description.trim();

    // Auto add description to ExpenseMaster if not existing
    try {
      await prisma.expenseMaster.upsert({
        where: { description: cleanDesc },
        update: {},
        create: { description: cleanDesc },
      });
    } catch (e) {
      // Ignore unique constraint error
    }

    const expense = await prisma.expense.create({
      data: {
        date: date ? new Date(date) : new Date(),
        description: cleanDesc,
        amount: Number(amount),
        notes: notes ? notes.trim() : null,
      },
    });

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// PUT update expense
router.put('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { date, description, amount, notes } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const cleanDesc = description.trim();

    try {
      await prisma.expenseMaster.upsert({
        where: { description: cleanDesc },
        update: {},
        create: { description: cleanDesc },
      });
    } catch (e) {
      // Ignore
    }

    const updatedExpense = await prisma.expense.update({
      where: { id },
      data: {
        date: date ? new Date(date) : undefined,
        description: cleanDesc,
        amount: Number(amount),
        notes: notes !== undefined ? (notes ? notes.trim() : null) : undefined,
      },
    });

    res.json(updatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// DELETE expense
router.delete('/:id', authorizeRole('PLANT_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.expense.delete({
      where: { id },
    });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
