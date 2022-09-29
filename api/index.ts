import Koa from 'koa';
import Router from '@koa/router'
import multer from '@koa/multer'
import json from 'koa-json'
import dayjs from 'dayjs';
import pug from 'pug';

import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);
const port = parseInt(process.env.PORT) || 3000;
const default_chat_id = process.env.CHAT_ID;

const app = new Koa();
const router = new Router();
const caption = pug.compileFile(__dirname + '/views/caption.pug');

router.get('/api/hello', async (ctx) => {
    ctx.body = {
        'message': 'hello, world'
    }
});

router.post('/api/inbound/:chat_id', multer().fields([]), async (ctx) => {
    let fields = ctx.request.body;
    let chat_id = parseInt(ctx.request.params.chat_id || default_chat_id);

    // Check email parameters
    if (!(fields && fields.from && fields.to && fields.email)) {
        ctx.status = 400;
        ctx.body = {
            'message': 'Incorrect parameters.'
        }
        return;
    }

    let receiver = fields.to.split(/,\s*/)[0];
    let filename = `sendgrid_${dayjs().format('YYYYMMDDhhmmss')}_${receiver}.eml`;

    await bot.telegram.sendDocument(chat_id, {
        source: Buffer.from(fields.email),
        filename
    }, {
        caption: caption(fields),
        parse_mode: 'HTML'
    })

    ctx.status = 200
})

app.use(json())
    .use(router.routes())
    .use(router.allowedMethods())
    .use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            err.status = err.statusCode || err.status || 500;
            throw err;
        }
    })
    .listen(port);
