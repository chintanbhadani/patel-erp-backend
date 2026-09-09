import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupIotScaleListener } from './services/iotScaleListener';
import { authorizeRole } from './middleware/auth';
import jobsRouter from './routes/jobs';
import inventoryRouter from './routes/inventory';
import authRouter from './routes/auth';
import clientsRouter from './routes/clients';
import outlookRouter from './routes/outlook';
import expenseRouter from './routes/expense.routes';
import invoiceRouter from './routes/invoice.routes';
import categoryRouter from './routes/category.routes';
import supplierRouter from './routes/supplier.routes';
import unitRouter from './routes/unit.routes';
import skuMasterRouter from './routes/skuMaster.routes';
import cron from 'node-cron';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Setup Socket.io for web dashboard (HTTP Server)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Routes setup
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Manufacturing ERP Backend Running' });
});

// Example of guarded route
app.get('/api/financials', authorizeRole('PLANT_ADMIN'), (req, res) => {
  res.json({ data: 'Sensitive financial data' });
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/outlook', outlookRouter);
app.use('/api/expenses', expenseRouter);
app.use('/api/invoices', invoiceRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/units', unitRouter);
app.use('/api/skuMaster', skuMasterRouter);

// Start IoT Scale Listener (TCP Server on port 9000)
setupIotScaleListener(io, 9000);

// Schedule Cron Job for 12 PM (noon) every day
cron.schedule('0 12 * * *', async () => {
  console.log('Running daily Outlook contacts sync...');
  try {
    const { PrismaClient } = require('@prisma/client');
    const { Client } = require('@microsoft/microsoft-graph-client');
    require('isomorphic-fetch');
    const prisma = new PrismaClient();
    
    const connections = await prisma.outlookConnection.findMany();
    for (const conn of connections) {
      try {
        const client = Client.init({ authProvider: (done: any) => done(null, conn.accessToken) });
        const contactsRes = await client.api('/me/contacts')
          .select('displayName,companyName,emailAddresses,businessPhones,mobilePhone')
          .top(100).get();
        
        let syncedCount = 0;
        for (const contact of contactsRes.value) {
          const email = contact.emailAddresses?.[0]?.address;
          const phone = contact.mobilePhone || contact.businessPhones?.[0];
          const companyName = contact.companyName || contact.displayName || 'Unknown Company';
          
          if (email || phone) {
            const conditions: any[] = [];
            if (email) conditions.push({ email });
            if (phone) conditions.push({ phone });
            
            const existing = await prisma.client.findFirst({ where: { OR: conditions } });
            if (!existing) {
              await prisma.client.create({
                data: { companyName, email, phone, assignedRepId: conn.userId }
              });
              syncedCount++;
            }
          }
        }
        console.log(`Synced ${syncedCount} contacts for user ${conn.userId}`);
      } catch (err) {
        console.error(`Error syncing for user ${conn.userId}:`, err);
      }
    }
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`HTTP API Server running on port ${PORT}`);
});
