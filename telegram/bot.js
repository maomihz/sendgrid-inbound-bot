const Telegraf = require('telegraf');
const config = require('../config/config');

const bot = new Telegraf(config.token);

bot.start((ctx) => ctx.reply('hello, world'));

module.exports = bot;
