import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import { prisma } from '../config/database.js';

describe('Guest WhatsApp Integration Test Suite (Step 4)', () => {
  let server;
  let baseUrl;
  const hotelId = 'hotel-mercier';
  const testPhone = '32499112233';

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}/api`;
        resolve();
      });
    });

    // Cleanup previous test records
    await prisma.message.deleteMany({
      where: { conversation: { guest: { id: `g-wa-${testPhone}` } } },
    }).catch(() => {});
    await prisma.conversation.deleteMany({
      where: { guestId: `g-wa-${testPhone}` },
    }).catch(() => {});
    await prisma.reservation.deleteMany({
      where: { guestId: `g-wa-${testPhone}` },
    }).catch(() => {});
    await prisma.guest.deleteMany({
      where: { id: `g-wa-${testPhone}` },
    }).catch(() => {});
    await prisma.task.deleteMany({
      where: { hotelId, room: '204', title: { contains: 'Towel' } },
    }).catch(() => {});
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. GET /api/whatsapp/webhook handles Meta verification challenge handshake', async () => {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'hotelogx_secret_token';
    const challenge = '1158201444';

    const res = await fetch(
      `${baseUrl}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`
    );

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, challenge);
  });

  test('2. POST /api/whatsapp/webhook processes inbound WhatsApp message, creates Guest, Conversation, and PMS Reservation', async () => {
    const payload = {
      hotelId,
      fromPhone: testPhone,
      senderName: 'Lucas Moreau',
      message: 'Hello, what time is breakfast served tomorrow morning?',
    };

    const res = await fetch(`${baseUrl}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data.conversationId);
    assert.ok(json.data.guestId);

    // Verify Guest in MySQL
    const guest = await prisma.guest.findUnique({
      where: { id: json.data.guestId },
    });
    assert.ok(guest);
    assert.equal(guest.name, 'Lucas Moreau');

    // Verify Conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: json.data.conversationId },
      include: { messages: true },
    });
    assert.ok(conversation);
    assert.equal(conversation.primaryChannel, 'whatsapp');
    assert.equal(conversation.aiStatus, 'ai-handling');
    assert.ok(conversation.messages.length >= 1);
    const guestMsg = conversation.messages.find((m) => m.author === 'guest');
    assert.ok(guestMsg);
    assert.equal(guestMsg.channel, 'whatsapp');

    // Verify Breakfast response generated from Knowledge Base
    assert.ok(
      conversation.suggestedReply.toLowerCase().includes('breakfast') ||
      conversation.suggestedReply.toLowerCase().includes('07:00')
    );
  });

  test('3. POST /api/whatsapp/webhook with Room 204 and towel request auto-creates Housekeeping Task and links PMS', async () => {
    const towelPayload = {
      hotelId,
      fromPhone: testPhone,
      senderName: 'Lucas Moreau',
      message: 'Could you please bring 2 extra bath towels for Room 204?',
    };

    const res = await fetch(`${baseUrl}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(towelPayload),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);

    // Verify Room 204 is linked to Guest
    const guest = await prisma.guest.findUnique({
      where: { id: json.data.guestId },
    });
    assert.ok(guest);
    assert.equal(guest.room, '204');

    // Verify PMS Reservation in MySQL
    const reservation = await prisma.reservation.findFirst({
      where: { guestId: json.data.guestId },
    });
    assert.ok(reservation);
    assert.equal(reservation.number, 'RES-204');
    assert.equal(reservation.status, 'In House');

    // Verify Housekeeping Task created in MySQL
    const task = await prisma.task.findFirst({
      where: {
        hotelId,
        department: 'Housekeeping',
        room: '204',
      },
    });
    assert.ok(task);
    assert.ok(task.title.toLowerCase().includes('towel'));
  });

  test('4. POST /api/whatsapp/send dispatches outbound WhatsApp message safely', async () => {
    const sendPayload = {
      to: testPhone,
      message: 'Your towels have been delivered to Room 204. Enjoy your stay!',
    };

    const res = await fetch(`${baseUrl}/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data.success);
  });
});
