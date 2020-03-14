const Telegraf = require('telegraf');

class MyContext extends Telegraf.Context {
    constructor (update, telegram, options) {
        super(update, telegram, options)
    }


    replyWithTemplate(template, extra) {
        this.telegram.response.render(template, (err, str) => {
            if (err) {
                throw err;
            } else {
                this.reply(str, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...extra
                });
            }
        });
    }
}

module.exports = MyContext;
