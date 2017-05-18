var express       = require('express');
var router        = express.Router();

router.get('/', (req, res, next) => {
    res.send("Welcome-Get");
    return;
});

router.post('/', (req, res, next) => {
    res.send("Welcome-Post");
    return;
});

module.exports = router;
