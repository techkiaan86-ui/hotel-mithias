import path from 'path';
import { prisma } from '../../config/database.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { parseFile } from '../../utils/parser.js';
import { chunkText } from '../../utils/chunker.js';
import { saveKnowledgeFile, deleteKnowledgeFile } from '../../utils/fileStorage.js';

/**
 * Format raw byte size into human readable string
 */
function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * GET /api/knowledge
 * List knowledge documents for the authenticated hotel tenant
 */
export async function listKnowledge(req, res, next) {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Hotel context missing or unauthorized', 401);
    }

    const docs = await prisma.knowledgeDoc.findMany({
      where: { hotelId },
      orderBy: { createdAt: 'desc' },
    });

    return successResponse(res, docs, 'Knowledge documents fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/knowledge
 * Authenticated multipart upload for knowledge document
 */
export async function uploadKnowledge(req, res, next) {
  let savedFile = null;
  let doc = null;

  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Hotel context missing or unauthorized', 401);
    }

    const file = req.file;
    if (!file) {
      return errorResponse(res, 'No file uploaded', 400);
    }

    const { category } = req.body;
    const ext = path.extname(file.originalname).replace(/^\./, '').toUpperCase() || 'TXT';

    // 1. Physically store the uploaded file with UUID filename in storage/knowledge/<hotelId>/
    savedFile = await saveKnowledgeFile(hotelId, file);

    // 2. Create KnowledgeDoc with initial uploading status
    doc = await prisma.knowledgeDoc.create({
      data: {
        hotelId,
        name: file.originalname,
        category: category || 'Hotel Policies',
        format: ext,
        size: formatSize(file.size),
        status: 'uploading',
        aiReady: false,
        usedToday: 0,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storagePath: savedFile.relativePath,
        updated: 'Just now',
      },
    });

    // 3. Parse file content
    let text = '';
    try {
      text = await parseFile(file);
    } catch (parseError) {
      console.warn(`[KnowledgeService] Parse failure for doc ${doc.id}:`, parseError.message);
      await prisma.knowledgeDoc.update({
        where: { id: doc.id },
        data: {
          status: 'error',
          errorMessage: 'Failed to extract text from file format',
          aiReady: false,
        },
      });
      return errorResponse(res, 'File parsing failed', 400);
    }

    // 4. Split into chunks (default 1000 characters) and persist KnowledgeChunk rows
    const chunks = chunkText(text, 1000);
    if (chunks.length > 0) {
      const chunkCreates = chunks.map((c) =>
        prisma.knowledgeChunk.create({
          data: {
            knowledgeDocId: doc.id,
            hotelId: hotelId,
            chunkIndex: c.index,
            content: c.content,
          },
        })
      );
      await Promise.all(chunkCreates);
    }

    // 5. Update status to indexed
    const updatedDoc = await prisma.knowledgeDoc.update({
      where: { id: doc.id },
      data: {
        status: 'indexed',
        aiReady: true,
      },
    });

    return successResponse(res, updatedDoc, 'Knowledge document uploaded and indexed');
  } catch (err) {
    // Clean up partial physical file on unexpected failure
    if (savedFile?.relativePath) {
      await deleteKnowledgeFile(savedFile.relativePath);
    }
    if (doc?.id) {
      try {
        await prisma.knowledgeDoc.update({
          where: { id: doc.id },
          data: { status: 'error', errorMessage: 'Internal processing error' },
        });
      } catch (_) {}
    }
    next(err);
  }
}

/**
 * DELETE /api/knowledge/:id
 * Delete knowledge document, associated chunks, and physical stored file
 */
export async function deleteKnowledge(req, res, next) {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Hotel context missing or unauthorized', 401);
    }

    const { id } = req.params;
    const doc = await prisma.knowledgeDoc.findUnique({
      where: { id },
    });

    if (!doc || doc.hotelId !== hotelId) {
      return errorResponse(res, 'Knowledge document not found', 404);
    }

    // 1. Delete physical stored file
    if (doc.storagePath) {
      await deleteKnowledgeFile(doc.storagePath);
    }

    // 2. Delete associated chunks (and cascade via DB if supported)
    await prisma.knowledgeChunk.deleteMany({
      where: { knowledgeDocId: id },
    });

    // 3. Delete KnowledgeDoc row
    await prisma.knowledgeDoc.delete({
      where: { id },
    });

    return successResponse(res, { id }, 'Knowledge document deleted');
  } catch (err) {
    next(err);
  }
}
