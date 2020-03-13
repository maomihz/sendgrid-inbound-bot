const moment = require('moment');

const bot = require('../telegram/bot');
const config = require('../config/config');

module.exports = (req, res, next) => {
    let fields = req.body;
    // Check email parameters
    if (!(fields && fields.from && fields.to && fields.email)) {
        res.status(400).json({ 'message': 'Incorrect parameters.' });
        return;
    }

    let receiver = fields.to.split(/,\s*/)[0];
    let filename = `sendgrid_${moment().format('YYYYMMDDhhmmss')}_${receiver}.eml`;

    res.render('message.ejs', { email: fields }, (err, str) => {
        if (err) {
            console.error(err);
            next('error');
            return;
        }

        bot.telegram.sendDocument(config.chat, {
            source: Buffer.from(fields.email),
            filename
        }, {
            caption: str,
            parse_mode: 'HTML'
        })
        .then(() => {
            res.status(200).send(str);
        });
    });
};
