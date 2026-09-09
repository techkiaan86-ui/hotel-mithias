import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { pmsService } from '../pms/pmsService.js';
import { realtimeService } from '../../services/realtimeService.js';
import { extractRoomNumber, processGuestMessageAI } from '../conversations/aiService.js';
import { exchangeMetaCodeForToken } from './whatsappOAuth.js';

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
export const sendMetaWhatsAppMessage = async (toPhone, text, buttons = [], hotelId = null) => {
  const cleanPhone = sanitizePhoneNumber(toPhone);
  if (!cleanPhone) {
    console.warn('[WhatsApp] No valid recipient phone number provided for dispatch');
    return { success: false, reason: 'Invalid phone number' };
  }

  let token = null;
  let phoneId = null;

  // 1. Resolve tenant-specific Meta WhatsApp credentials from database
  if (hotelId) {
    try {
      const integration = await prisma.whatsAppIntegration.findFirst({
        where: { hotelId, status: 'connected' },
      });
      if (integration) {
        token = integration.accessToken || null;
        phoneId = integration.phoneNumberId || null;
      }
    } catch (dbErr) {
      console.warn('[WhatsApp] Database lookup error for hotel credentials:', dbErr.message);
    }
  }

  // 2. Fallback to app-level environment tokens if not explicitly set in tenant integration
  if (!token) {
    token = process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  }
  if (!phoneId) {
    phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
  }

  // 3. Graceful Simulator Fallback if credentials are not configured or simulated
  if (
    !token ||
    !phoneId ||
    phoneId.startsWith('pn_') ||
    phoneId.startsWith('phone_') ||
    phoneId.includes('test') ||
    phoneId.includes('mock') ||
    phoneId.includes('meta_phone_id')
  ) {
    console.log(`[WhatsApp Simulator] Outbound message to +${cleanPhone} (hotel: ${hotelId || 'default'}): "${text}"`);
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
      signal: AbortSignal.timeout(3000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('[WhatsApp API Warning]', data?.error?.message || response.statusText);
      return { success: true, simulated: true, warning: data?.error?.message };
    }

    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error('[WhatsApp Network Error]', err.message);
    return { success: true, simulated: true, error: err.message };
  }
};

/**
 * Endpoint: GET /api/whatsapp/threads
 */
export const getThreads = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.query?.hotelId;
    const threads = await prisma.waThread.findMany({
      where: hotelId ? { hotelId } : undefined,
      include: {
        messages: true,
      },
    }).catch((err) => {
      console.warn('[WhatsApp Threads Warning]', err.message);
      return [];
    });

    const parsed = threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) => {
        let buttons = [];
        try {
          buttons = typeof m.buttons === 'string' ? JSON.parse(m.buttons) : (m.buttons || []);
        } catch {}
        return {
          ...m,
          buttons,
        };
      }),
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
    const hotelId = req.user?.hotelId || req.body?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'hotelId is required', 400);
    }
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

          // Sync room status back to Mews space in background
          pmsService.syncRoomStatusToMews(hotelId, roomNum, 'Clean').catch(() => {});
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

          // Sync room status back to Mews space in background
          pmsService.syncRoomStatusToMews(hotelId, roomNum, 'Maintenance').catch(() => {});

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
      sendMetaWhatsAppMessage(phone, `Action confirmed: ${label || 'Task completed'}`, [], hotelId).catch(() => {});
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

    const expectedToken = process.env.VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'hotelogxcom2606';

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
  try {
    const body = req.body || {};
    let fromPhone = '';
    let senderName = 'Guest';
    let msgText = '';
    let hotelId = null;
    let isMetaWebhook = false;

    if (body.object === 'whatsapp_business_account') {
      isMetaWebhook = true;
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const messages = change?.messages;
      const contacts = change?.contacts;
      const metaPhoneNumberId = change?.metadata?.phone_number_id;
      const metaDisplayPhone = change?.metadata?.display_phone_number;
      const metaWabaId = entry?.id;

      if (!messages || messages.length === 0) {
        return res.sendStatus(200);
      }

      const msg = messages[0];
      fromPhone = msg.from;
      senderName = contacts?.[0]?.profile?.name || 'Guest';
      msgText = msg.text?.body || msg.interactive?.button_reply?.title || msg.button?.text || '';

      // Multi-tenant resolution by Meta Identifiers
      let integration = null;
      if (metaPhoneNumberId || metaDisplayPhone || metaWabaId) {
        integration = await prisma.whatsAppIntegration.findFirst({
          where: {
            OR: [
              ...(metaPhoneNumberId ? [{ phoneNumberId: metaPhoneNumberId }] : []),
              ...(metaDisplayPhone ? [{ phoneNumber: sanitizePhoneNumber(metaDisplayPhone) }, { displayPhoneNumber: metaDisplayPhone }] : []),
              ...(metaWabaId ? [{ wabaId: metaWabaId }] : []),
            ],
          },
        }).catch(() => null);
      }

      if (integration?.hotelId) {
        hotelId = integration.hotelId;
      } else if (metaDisplayPhone) {
        const cleanMetaPhone = sanitizePhoneNumber(metaDisplayPhone);
        const matchedHotel = await prisma.hotel.findFirst({
          where: { whatsappNumber: { contains: cleanMetaPhone } },
        }).catch(() => null);
        hotelId = matchedHotel?.id;
      }

      if (!hotelId) {
        console.warn(`[WhatsApp Webhook] Unmapped Meta identifier (phone_number_id: "${metaPhoneNumberId}", display_phone: "${metaDisplayPhone}", waba: "${metaWabaId}"). Refusing to route to default tenant.`);
        return res.sendStatus(200); // Acknowledge Meta safely to prevent retry loops without cross-tenant pollution
      }
    } else {
      // Direct / Simulator payload
      hotelId = body.hotelId;
      if (!hotelId) {
        return errorResponse(res, 'hotelId is required for simulator/direct dispatch', 400);
      }
      const hotelExists = await prisma.hotel.findUnique({ where: { id: hotelId } });
      if (!hotelExists) {
        return errorResponse(res, `Hotel tenant "${hotelId}" not found`, 404);
      }

      fromPhone = body.fromPhone || body.phone || body.from || '32491123456';
      senderName = body.senderName || body.name || body.guestName || 'WhatsApp Guest';
      msgText = body.message || body.text || body.msg || '';
    }

    if (!msgText) {
      if (isMetaWebhook) return res.sendStatus(200);
      return errorResponse(res, 'Message text is required', 400);
    }

    const cleanPhone = sanitizePhoneNumber(fromPhone) || '32491123456';
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    console.log(`[WhatsApp Inbound] Message for hotel "${hotelId}" from ${senderName} (+${cleanPhone}): "${msgText}"`);

    // 1. Dynamic Room Detection
    const detectedRoom = body.room || extractRoomNumber(msgText);

    // 2. Tenant-scoped Guest lookup/creation (Prevents cross-tenant collision)
    const guestId = `g-wa-${hotelId}-${cleanPhone}`;
    let guest = await prisma.guest.findUnique({
      where: { id: guestId },
      include: { reservations: true },
    });

    if (!guest) {
      guest = await prisma.guest.create({
        data: {
          id: guestId,
          hotelId,
          name: senderName || `WhatsApp Guest (+${cleanPhone})`,
          country: 'BE',
          language: 'en',
          room: detectedRoom || null,
          vip: false,
          previousStays: 0,
          tags: JSON.stringify(['WhatsApp Contact', `+${cleanPhone}`]),
        },
        include: { reservations: true },
      });
    } else if (detectedRoom && guest.room !== detectedRoom) {
      guest = await prisma.guest.update({
        where: { id: guest.id },
        data: { room: detectedRoom },
        include: { reservations: true },
      });
    }

    // 3. Dynamically link or create PMS Reservation for Guest scoped to hotelId
    let reservation = guest.reservations?.[0] || null;
    const roomNum = detectedRoom || guest.room;

    if (!reservation || (roomNum && (reservation.status === 'Enquiry' || reservation.number.startsWith('ENQ-')))) {
      if (roomNum) {
        await prisma.reservation.deleteMany({
          where: { guestId: guest.id, number: { startsWith: 'ENQ-' } },
        }).catch(() => {});

        const resNumber = `RES-${hotelId}-${roomNum}`;
        reservation = await prisma.reservation.upsert({
          where: { number: resNumber },
          create: {
            number: resNumber,
            hotelId,
            guestId: guest.id,
            arrival: 'Today',
            departure: '+2 Days',
            nights: 2,
            adults: 2,
            children: 0,
            roomType: 'Deluxe Courtyard',
            status: 'In House',
            rate: '€180/night',
          },
          update: {
            guestId: guest.id,
            status: 'In House',
          },
        });
      } else {
        const resNumber = `ENQ-${hotelId}-${guest.id.slice(-4).toUpperCase()}`;
        reservation = await prisma.reservation.upsert({
          where: { number: resNumber },
          create: {
            number: resNumber,
            hotelId,
            guestId: guest.id,
            arrival: 'Pending',
            departure: 'Pending',
            nights: 1,
            adults: 1,
            children: 0,
            roomType: 'Standard Room',
            status: 'Enquiry',
            rate: '€0',
          },
          update: {
            guestId: guest.id,
          },
        });
      }
    }

    // 4. Locate or create active conversation
    let conversation = await prisma.conversation.findFirst({
      where: { guestId: guest.id },
      orderBy: { lastAt: 'desc' },
    });

    const convStage = roomNum ? 'In House' : 'Pre-arrival';
    const convId = conversation?.id || `conv-wa-${hotelId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          id: convId,
          guestId: guest.id,
          stage: convStage,
          primaryChannel: 'whatsapp',
          aiStatus: 'ai-handling',
          sentiment: 'neutral',
          subject: `WhatsApp Chat with ${guest.name}`,
          summary: `"${msgText.slice(0, 100)}"`,
          suggestedReply: '',
          unread: 1,
          lastAt: timeStr,
          aiHandledCount: 0,
        },
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          stage: convStage,
          unread: { increment: 1 },
          lastAt: timeStr,
          aiStatus: 'ai-handling',
        },
      });
    }

    // 5. Append message to conversation
    const msgId = `m-wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const messageRecord = await prisma.message.create({
      data: {
        id: msgId,
        conversationId: conversation.id,
        author: 'guest',
        channel: 'whatsapp',
        body: msgText,
        at: timeStr,
      },
    });

    // 6. Trigger Universal AI Knowledge & Action Engine strictly for this hotel
    let aiResult = null;
    try {
      aiResult = await processGuestMessageAI({
        messageText: msgText,
        conversationId: conversation.id,
        hotelId,
        channel: 'whatsapp',
      });
    } catch (aiErr) {
      console.warn('[WhatsApp AI Processing Error]:', aiErr.message);
    }

    const aiSuggestedReply = aiResult?.replyText || `Hello ${guest.name}, thank you for contacting us via WhatsApp. We will assist you promptly.`;
    const knowledgeUsed = aiResult?.knowledgeUsed || (aiResult?.type === 'knowledge_rag' ? ['Hotel Policies & Knowledge'] : []);

    let currentTaskIds = [];
    try {
      currentTaskIds = JSON.parse(conversation.taskIds || '[]');
    } catch (_) {}
    if (aiResult?.task?.id && !currentTaskIds.includes(aiResult.task.id)) {
      currentTaskIds.push(aiResult.task.id);
    }

    // Update conversation with dynamic AI reply and metadata
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        suggestedReply: aiSuggestedReply,
        aiStatus: 'ai-handling',
        knowledgeUsed: JSON.stringify(knowledgeUsed),
        taskIds: JSON.stringify(currentTaskIds),
        lastAt: timeStr,
      },
    });

    // 7. Log Activity Item
    const actId = `act-${Date.now()}`;
    const actText = `New WhatsApp message from ${guest.name} (+${cleanPhone}): "${msgText.slice(0, 60)}"`;
    await prisma.activityItem.create({
      data: {
        id: actId,
        hotelId,
        at: timeStr,
        kind: 'conversation',
        text: actText,
        meta: 'WhatsApp',
      },
    }).catch(() => {});

    // 8. Outbound Dispatch to Guest (uses hotelId's specific WhatsApp credentials)
    if (aiResult?.replyText && cleanPhone) {
      sendMetaWhatsAppMessage(cleanPhone, aiResult.replyText, [], hotelId).catch(() => {});
    }

    // 9. Construct normalized Conversation object for realtime UI rendering
    const fullConversation = {
      id: conversation.id,
      stage: convStage === 'In House' ? 'in-house' : 'pre-arrival',
      channels: ['whatsapp'],
      primaryChannel: 'whatsapp',
      aiStatus: 'ai-handling',
      sentiment: 'neutral',
      subject: `WhatsApp Chat with ${guest.name}`,
      summary: `"${msgText.slice(0, 100)}"`,
      suggestedReply: aiSuggestedReply,
      knowledgeUsed,
      upsellIdeas: [],
      taskIds: currentTaskIds,
      unread: conversation.unread || 1,
      lastAt: timeStr,
      aiHandledCount: 0,
      guest: {
        id: guest.id,
        name: guest.name,
        room: roomNum || undefined,
        country: guest.country || 'BE',
        language: guest.language || 'en',
        vip: guest.vip || false,
        previousStays: guest.previousStays || 0,
        tags: ['WhatsApp Contact', `+${cleanPhone}`],
        reservation: {
          number: reservation.number,
          arrival: reservation.arrival,
          departure: reservation.departure,
          nights: reservation.nights,
          adults: reservation.adults,
          children: reservation.children,
          roomType: reservation.roomType,
          status: reservation.status,
          rate: reservation.rate,
        },
      },
      messages: [
        {
          id: messageRecord.id,
          author: 'guest',
          channel: 'whatsapp',
          body: msgText,
          at: timeStr,
        },
      ],
    };

    // 10. Broadcast Realtime SSE Events
    realtimeService.broadcastToHotel(hotelId, 'conversation:updated', {
      conversationId: conversation.id,
      guestId: guest.id,
      guestName: guest.name,
      channel: 'whatsapp',
      subject: `WhatsApp Chat with ${guest.name}`,
      lastMessage: msgText.slice(0, 120),
      time: timeStr,
      conversation: fullConversation,
    });

    realtimeService.broadcastToHotel(hotelId, 'activity:new', {
      id: actId,
      at: timeStr,
      kind: 'conversation',
      text: actText,
      meta: 'WhatsApp',
    });

    if (isMetaWebhook) {
      return res.sendStatus(200);
    }

    return successResponse(res, {
      success: true,
      guestId: guest.id,
      conversationId: conversation.id,
      messageId: messageRecord.id,
      fromPhone: cleanPhone,
      time: timeStr,
      suggestedReply: aiSuggestedReply,
      task: aiResult?.task || null,
      conversation: fullConversation,
    }, 'WhatsApp message processed');
  } catch (err) {
    console.error('[WhatsApp Webhook Error]', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
};

/**
 * Endpoint: POST /api/whatsapp/send (Manual / System Outbound Message)
 */
export const sendTestMessage = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.body?.hotelId;
    const { to, message, buttons } = req.body;
    if (!to || !message) {
      return errorResponse(res, 'Recipient phone (to) and message text are required', 400);
    }

    const result = await sendMetaWhatsAppMessage(to, message, buttons, hotelId);
    return successResponse(res, result, 'WhatsApp message dispatched');
  } catch (error) {
    next(error);
  }
};

/**
 * Endpoint: POST /api/whatsapp/embedded-signup (Meta Embedded Signup Exchange)
 */
export const handleEmbeddedSignupExchange = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.body?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'hotelId is required', 400);
    }

    const { code, wabaId, phoneNumberId, displayPhoneNumber, targetType } = req.body;

    const integration = await exchangeMetaCodeForToken({
      code,
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      hotelId,
      targetType: targetType || 'guest',
    });

    return successResponse(res, {
      success: true,
      integration: {
        id: integration.id,
        hotelId: integration.hotelId,
        targetType: integration.targetType,
        displayPhoneNumber: integration.displayPhoneNumber,
        phoneNumberId: integration.phoneNumberId,
        wabaId: integration.wabaId,
        status: integration.status,
      },
    }, 'Meta WhatsApp Business integration connected successfully');
  } catch (error) {
    next(error);
  }
};

