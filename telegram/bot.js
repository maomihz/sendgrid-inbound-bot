const Telegraf = require('telegraf');
const config = require('../config/config');
const Context = require('./context');

const bot = new Telegraf(config.token, { contextType: Context });

bot.start(ctx => ctx.replyWithTemplate('start.ejs'));
bot.help(ctx => ctx.replyWithTemplate('help.ejs'));

module.exports = bot;
