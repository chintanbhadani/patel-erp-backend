import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

// Helper to upload file to Cloudflare R2 via S3 API
async function uploadToCloudflareR2(file: Express.Multer.File, req: Request): Promise<string | null> {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_BUCKETNAME;
  const publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || process.env.CLOUDFLARE_BUCKET_URL;

  if (accountId && accessKeyId && secretAccessKey && bucketName) {
    try {
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      });

      const cleanFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `uploads/${Date.now()}-${cleanFilename}`;

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype
      }));

      // If publicDomain is explicitly provided and valid, use it; otherwise use the local proxy endpoint
      if (publicDomain && publicDomain.trim() !== '' && !publicDomain.includes('pub-643733d4cc774864809a38867206c287')) {
        const baseUrl = publicDomain.endsWith('/') ? publicDomain.slice(0, -1) : publicDomain;
        return `${baseUrl}/${filename}`;
      }

      // Proxy fallback endpoint
      const host = req.get('host') || 'localhost:8005';
      const protocol = req.protocol || 'http';
      return `${protocol}://${host}/api/upload/file/${filename}`;
    } catch (err) {
      console.error('Cloudflare R2 Upload Error:', err);
    }
  } else {
    console.warn('Cloudflare R2 credentials missing or incomplete');
  }
  return null;
}

// GET /api/upload/file/* - Serve R2 files directly through backend proxy
router.get('/file/*', async (req: Request, res: Response) => {
  try {
    const key = req.params[0];
    if (!key) return res.status(404).send('File key required');

    const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_ACCESS_KEY;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_BUCKETNAME;

    if (accountId && accessKeyId && secretAccessKey && bucketName) {
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey }
      });

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      });

      const data = await s3.send(command);
      if (data.ContentType) res.setHeader('Content-Type', data.ContentType);
      if (data.ContentLength) res.setHeader('Content-Length', data.ContentLength);
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const stream = data.Body as any;
      return stream.pipe(res);
    }

    return res.status(404).send('Storage not configured');
  } catch (error: any) {
    console.error('Failed to serve R2 file:', error);
    return res.status(404).send('File not found');
  }
});

// POST /api/upload
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // 1. Try uploading to Cloudflare R2
    const r2Url = await uploadToCloudflareR2(req.file, req);
    if (r2Url) {
      return res.json({ url: r2Url, filename: req.file.originalname, provider: 'cloudflare_r2' });
    }

    // 2. Fallback: Base64 Data URL
    const base64Data = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64Data}`;
    return res.json({ url: dataUrl, filename: req.file.originalname, provider: 'base64_fallback' });
  } catch (error: any) {
    console.error('File upload error:', error);
    return res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

export default router;
