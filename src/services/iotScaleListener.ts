import net from 'net';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function setupIotScaleListener(io: Server, port: number = 9000) {
  const server = net.createServer((socket) => {
    console.log('IoT Scale connected:', socket.remoteAddress, socket.remotePort);

    socket.on('data', async (data) => {
      try {
        const rawString = data.toString().trim();
        // Example logic: expecting a simple float value string from the scale
        const grossWeight = parseFloat(rawString);

        if (isNaN(grossWeight)) {
          console.warn('Invalid weight string received from scale:', rawString);
          return;
        }

        const coreTareWeight = 1.0; // standard paper core weight
        const netWeight = grossWeight - coreTareWeight;

        // Broadcast to clients listening to real-time scale data
        io.emit('scaleData', {
          raw: rawString,
          grossWeight,
          tareWeight: coreTareWeight,
          netWeight,
        });
        
        console.log(`Processed weight: Gross ${grossWeight}kg, Tare ${coreTareWeight}kg, Net ${netWeight}kg`);

      } catch (error) {
        console.error('Error processing scale data:', error);
      }
    });

    socket.on('end', () => {
      console.log('IoT Scale disconnected');
    });

    socket.on('error', (err) => {
      console.error('IoT Scale socket error:', err);
    });
  });

  server.listen(port, () => {
    console.log(`IoT Weighing Scale Listener TCP service running on port ${port}`);
  });
}
