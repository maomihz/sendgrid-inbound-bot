const router = require('express').Router();

const multer = require('multer')();

router.post('/inbound', multer.none(), require('./inbound'));

module.exports = router;
