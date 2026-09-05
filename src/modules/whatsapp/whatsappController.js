import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/**
 * Helper: Sanitize phone numbers to pure E.164 digits without +, -, or spaces
 */
export const sanitizePhoneNumber = (phone) => {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
};

/**
 * Helper: Send Outbound WhatsApp Message via Meta Cloud Graph API
 */
export const sendMetaWhatsAppMessage = async (toPhone, text, buttons = []) => {
  const cleanPhone = sanitizePhoneNumber(toPhone);
  if (!cleanPhone) {
    console.warn('[WhatsApp] No valid recipient phone number provided for dispatch');
    return { success: false, reason: 'Invalid phone number' };
  }

  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;

  // Graceful Fallback if live credentials are not set in environment
  if (!token || !phoneId) {
    console.log(`[WhatsApp Simulator] Outbound message to +${cleanPhone}: "${text}"`);
    return { success: true, simulated: true };
  }

  try {
    let payload;

    if (buttons && buttons.length > 0) {
      // Interactive Button Message
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text || 'Action required' },
          action: {
            buttons: buttons.slice(0, 3).map((btn, idx) => ({
              type: 'reply',
              reply: {
                id: `btn_${idx}_${Date.now()}`,
                title: String(btn).slice(0, 20),
              },
            })),
          },
        },
      };
    } else {
      // Standard Text Message
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { preview_url: false, body: text },
      };
    }

    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      console.warn('[WhatsApp API Warning]', data?.error?.message || response.statusText);
      return { success: false, error: data?.error };
    }

    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error('[WhatsApp Network Error]', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Endpoint: GET /api/whatsapp/threads
 */
export const getThreads = async (req, res, next) => {
  try {
    const threads = await prisma.waThread.findMany({
      include: {
        messages: {
          orderBy: { at: 'asc' },
        },
      },
    });

    const parsed = threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({
        ...m,
        buttons: JSON.parse(m.buttons || '[]'),
      })),
    }));

    return successResponse(res, parsed, 'WhatsApp threads');
  } catch (error) {
    next(error);
  }
};

/**
 * Endpoint: POST /api/whatsapp/action
 */
export const handleAction = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.body?.hotelId || 'hotel-mercier';
    const { threadId, messageId, label, staffName, room, actionType, phone } = req.body;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // If messageId provided, mark chosen label
    if (messageId) {
      await prisma.waMessage.updateMany({
        where: { id: messageId },
        data: { chosen: label },
      }).catch(() => {});
    }

    const roomNum = room || label?.match(/\d{3}/)?.[0];

    // Multi-tenant Room Validation
    if (roomNum) {
      const roomRecord = await prisma.room.findFirst({
        where: { number: roomNum, hotelId },
      });

      if (roomRecord) {
        if (actionType === 'room_clean' || label === 'Cleaned' || label === 'Needs Inspection') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Clean', cleaner: staffName || roomRecord.cleaner || 'Staff', updatedAt: timeStr },
          });

          // Complete any active cleaning task in this hotel
          await prisma.task.updateMany({
            where: { room: roomNum, hotelId, department: 'Housekeeping', status: { not: 'Completed' } },
            data: { status: 'Completed' },
          });
        } else if (label === 'Start Cleaning' || label?.toLowerCase().includes('start cleaning')) {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Cleaning', cleaner: staffName || roomRecord.cleaner || 'Staff', updatedAt: timeStr },
          });
        } else if (label === 'Maintenance Issue') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Maintenance', note: `Issue reported via WhatsApp by ${staffName || 'Housekeeping'}` },
          });

          const issueId = `MT-${Date.now().toString().slice(-4)}`;
          await prisma.issue.create({
            data: {
              id: issueId,
              hotelId,
              room: roomNum,
              title: `Issue reported in ${roomNum} during cleaning`,
              detail: `Reported by ${staffName || 'Housekeeper'} via WhatsApp. Awaiting technician assessment.`,
              priority: 'High',
              reportedBy: staffName || 'Housekeeper via WhatsApp',
              via: 'WhatsApp',
              createdAt: timeStr,
              status: 'Open',
              outOfService: true,
            },
          }).catch(() => {});
        } else if (label === 'DND' || label === 'Guest Inside') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: label === 'DND' ? 'DND' : 'Guest Inside', updatedAt: timeStr },
          });
        }
      }
    }

    if (label?.toLowerCase().includes('delivered') || label?.toLowerCase().includes('done')) {
      const matchingTask = await prisma.task.findFirst({
        where: {
          hotelId,
          department: 'Housekeeping',
          status: { not: 'Completed' },
          ...(roomNum ? { room: roomNum } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (matchingTask) {
        await prisma.task.updateMany({
          where: { id: matchingTask.id, hotelId },
          data: { status: 'Completed' },
        });

        if (matchingTask.conversationId) {
          await prisma.message.create({
            data: {
              id: `m-${Date.now()}`,
              conversationId: matchingTask.conversationId,
              author: 'ai',
              channel: 'whatsapp',
              body: `Our housekeeping team has delivered this to Room ${matchingTask.room || roomNum || ''}. Please let us know if you need anything else.`,
              at: timeStr,
              confidence: 0.98,
            },
          }).catch(() => {});
        }

        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId,
            at: timeStr,
            kind: 'task',
            text: `Task completed via WhatsApp: "${matchingTask.title}"`,
            meta: staffName || 'Housekeeping',
          },
        }).catch(() => {});
      }
    }

    // Append outbound confirmation message in the database thread if thread exists
    if (threadId) {
      const threadExists = await prisma.waThread.findUnique({ where: { id: threadId } }).catch(() => null);
      if (threadExists) {
        await prisma.waMessage.create({
          data: {
            id: `wam-${Date.now()}`,
            threadId,
            from: 'staff',
            body: label || 'Action confirmed',
            at: timeStr,
          },
        }).catch(() => {});
      }
    }

    // If phone number exists, dispatch live Meta WhatsApp message safely
    if (phone) {
      sendMetaWhatsAppMessage(phone, `Action confirmed: ${label || 'Task completed'}`).catch(() => {});
    }

    return successResponse(res, { success: true, at: timeStr }, 'WhatsApp action processed');
  } catch (error) {
    next(error);
  }
};

/**
 * Endpoint: GET /api/whatsapp/webhook (Meta Webhook Verification Challenge)
 */
export const verifyWebhook = (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'hotelogx_secret_token';

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('[WhatsApp Webhook] Verification successful');
      return res.status(200).send(challenge);
    }

    console.warn('[WhatsApp Webhook] Verification token mismatch');
    return res.sendStatus(403);
  } catch (err) {
    return res.status(500).send(err.message);
  }
};

/**
 * Endpoint: POST /api/whatsapp/webhook (Inbound Message & Event Receiver)
 */
export const handleWebhook = async (req, res) => {
  // Return immediate 200 OK to Meta to avoid retry loops
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') {
      return;
    }

    // Safe payload traversal using optional chaining to prevent undefined crashes
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const messages = change?.messages;
    const contacts = change?.contacts;

    // If it is a delivery receipt or status update without message body, return early
    if (!messages || messages.length === 0) {
      return;
    }

    const msg = messages[0];
    const fromPhone = msg.from;
    const senderName = contacts?.[0]?.profile?.name || 'Guest';
    const msgText = msg.text?.body || msg.interactive?.button_reply?.title || msg.button?.text || '';

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    console.log(`[WhatsApp Inbound] Message from ${senderName} (+${fromPhone}): "${msgText}"`);

    // Log Activity Feed entry
    await prisma.activityItem.create({
      data: {
        id: `act-${Date.now()}`,
        at: timeStr,
        kind: 'ai-reply',
        text: `WhatsApp message from ${senderName} (+${fromPhone}): "${msgText.slice(0, 50)}"`,
        meta: 'Meta Cloud API',
      },
    }).catch(() => {});

  } catch (err) {
    console.error('[WhatsApp Webhook Error]', err.message);
  }
};

/**
 * Endpoint: POST /api/whatsapp/send (Manual / System Outbound Message)
 */
export const sendTestMessage = async (req, res, next) => {
  try {
    const { to, message, buttons } = req.body;
    if (!to || !message) {
      return errorResponse(res, 'Recipient phone (to) and message text are required', 400);
    }

    const result = await sendMetaWhatsAppMessage(to, message, buttons);
    return successResponse(res, result, 'WhatsApp message dispatched');
  } catch (error) {
    next(error);
  }
};
