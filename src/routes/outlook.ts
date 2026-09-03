import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authorizeRole } from '../middleware/auth';
import { ConfidentialClientApplication, Configuration } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';

const router = Router();
const prisma = new PrismaClient();

const msalConfig: Configuration = {
  auth: {
    clientId: process.env.OUTLOOK_CLIENT_ID || 'MISSING_CLIENT_ID',
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || 'MISSING_CLIENT_SECRET',
    authority: 'https://login.microsoftonline.com/common',
  }
};

const cca = new ConfidentialClientApplication(msalConfig);
const REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:5000/api/outlook/callback';
const SCOPES = ['User.Read', 'Contacts.Read'];

// 1. Initiate OAuth Flow
router.get('/auth', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const authCodeUrlParameters = {
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
      state: (req as any).user.id // Pass user ID in state to link account in callback
    };

    const authCodeUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
    res.json({ url: authCodeUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authentication URL' });
  }
});

// 2. Handle OAuth Callback
router.get('/callback', async (req, res) => {
  try {
    const userId = req.query.state as string;
    const code = req.query.code as string;

    if (!userId || !code) {
      return res.status(400).send('Missing state or code in callback.');
    }

    const tokenRequest = {
      code: code,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
    };

    const response = await cca.acquireTokenByCode(tokenRequest);
    
    if (response && response.accessToken) {
      const expiresAt = response.expiresOn || new Date(Date.now() + 3600 * 1000);
      
      await prisma.outlookConnection.upsert({
        where: { userId },
        update: {
          accessToken: response.accessToken,
          refreshToken: '', 
          expiresAt: expiresAt
        },
        create: {
          userId,
          accessToken: response.accessToken,
          refreshToken: '',
          expiresAt: expiresAt
        }
      });

      // Redirect back to frontend
      res.redirect('http://localhost:5173/clients');
    } else {
      res.status(400).send('Failed to acquire token.');
    }
  } catch (error) {
    console.error('Error in Outlook callback:', error);
    res.status(500).send('Authentication failed.');
  }
});

// 3. Check Connection Status
router.get('/status', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const connection = await prisma.outlookConnection.findUnique({
      where: { userId }
    });

    res.json({ connected: !!connection });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// 4. Sync Contacts
router.post('/sync', authorizeRole('PLANT_ADMIN', 'SALES_REP'), async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const connection = await prisma.outlookConnection.findUnique({
      where: { userId }
    });

    if (!connection) {
      return res.status(400).json({ error: 'Outlook not connected' });
    }

    // Initialize Graph Client
    const client = Client.init({
      authProvider: (done) => {
        done(null, connection.accessToken);
      }
    });

    // Fetch Contacts from Graph API
    const contactsResponse = await client.api('/me/contacts')
      .select('displayName,companyName,emailAddresses,businessPhones,mobilePhone')
      .top(100)
      .get();

    const contacts = contactsResponse.value;
    let syncedCount = 0;

    for (const contact of contacts) {
      const email = contact.emailAddresses && contact.emailAddresses.length > 0 ? contact.emailAddresses[0].address : null;
      const phone = contact.mobilePhone || (contact.businessPhones && contact.businessPhones.length > 0 ? contact.businessPhones[0] : null);
      const companyName = contact.companyName || contact.displayName || 'Unknown Company';

      if (email || phone) {
        // Find existing client to avoid duplicates
        const conditions: any[] = [];
        if (email) conditions.push({ email });
        if (phone) conditions.push({ phone });

        const existingClient = await prisma.client.findFirst({
          where: { OR: conditions }
        });

        if (!existingClient) {
          await prisma.client.create({
            data: {
              companyName,
              email,
              phone,
              assignedRepId: userId
            }
          });
          syncedCount++;
        }
      }
    }

    res.json({ success: true, message: `Synced ${syncedCount} new contacts.` });
  } catch (error: any) {
    console.error('Error syncing contacts:', error);
    if (error.statusCode === 401) {
       return res.status(401).json({ error: 'Outlook token expired. Please reconnect.' });
    }
    res.status(500).json({ error: 'Failed to sync contacts' });
  }
});

export default router;
