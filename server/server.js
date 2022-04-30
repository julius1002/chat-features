const crypto = require("crypto");
const Rx = require("rxjs")
const express = require('express');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require('cors');
const R = require("ramda");
const multer = require('multer');
const upload = multer({ dest: 'public/img' })
const loremIpsum = require('lorem-ipsum');

const app = express();
const expressWs = require('express-ws')(app);
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
app.options('*', cors());

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

/*
utils
*/

const toJSONStr = obj => JSON.stringify(obj)
const fromJSONStr = string => JSON.parse(string)
const sendToEachClient = msg => expressWs.getWss().clients.forEach(client => client.send(msg))

/*
db
*/
const users = ["Julius", 'Bill', "Dave"];

var rooms = [{ name: "AllTalk" }, { name: "Gaming" }, { name: "Studying" }, { name: "Relaxing" }]

/*const intervalledAnswer = new Rx.Subject()
intervalledAnswer.pipe(
    Rx.switchMap((value) => Rx.concat(
        Rx.interval(500)
            .pipe(
                Rx.take(5))
        , Rx.of(value)
            .pipe(
                Rx.repeat(5))
    )),
    Rx.tap(console.log)
).subscribe(sendToEachClient)*/

/*
 chat socket
*/

const answerOnMessageType =
{
    "message": value => { return { ...value, time: Date.now(), id: crypto.randomUUID(), read: false } },
    "room_change": value => { return { ...value, message: "", time: Date.now() } },
    "typing": value => { return { ...value, time: Date.now() } }
}

app.ws('/ws', function (ws, req) {
    Rx.fromEvent(ws, "message")
        .pipe(
            Rx.pluck("data"),
            Rx.map(fromJSONStr),
            Rx.tap(console.log),
            Rx.map(value => answerOnMessageType[value.type](value)),
            Rx.tap(console.log),
            Rx.map(toJSONStr)
        )

        .subscribe(sendToEachClient)
});

function randFromArr(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function sendRandomMessage() {
    sendToEachClient(toJSONStr({
        room: rooms.indexOf(randFromArr(rooms)) + "",
        message: loremIpsum.loremIpsum(),
        user: randFromArr(users),
        type: 'message',
        time: Date.now(),
        read: false,
        id: crypto.randomUUID()
    }))
}

Rx.interval(5_000).subscribe(() => sendRandomMessage())

/*
 upload
*/

app.post('/upload', upload.single('file'), function (req, res) {
    res.json({ location: `http://localhost:3000/img/${req.file.filename}` });
});

/*
rooms
*/

app.get("/rooms", (req, res, next) => res.json(rooms))

app.post("/rooms", (req, res, next) => {
    rooms = [...rooms, req.body]
    return res.json([...rooms, req.body]);
})

/*
user management
*/

app.get('/api/reactiveForms/usernameCheck/:username', (req, res, next) => res.json({ taken: ["Julius", "Dave"].includes(req.params.username) }));

app.get('/api/authenticate/:username', (req, res, next) => res.status(200).send({ name: req.params.username }));

/*
indexed db /pouchdb
*/

app.get("/transactions", (req, res, next) => res.json(
    [new Transaction("Maxi", "withdraw", 1337, "checking"),
    new Transaction("Moritz", "deposit", 123, "savings"),
    new Transaction("Lukas", "transfer", 222, "checking"),
    new Transaction("Kevin", "transfer", 333, "savings")])
)

class Transaction {
    name;
    type;
    from;
    to;
    amount;
    constructor(name, type, amount, from, to = null) {
        this.name = name;
        this.type = type;
        this.from = from;
        this.to = to;
        this.amount = amount;
    }
}

/*
Forms
*/
app.post('/reactiveForms/registration', (req, res, next) => res.send(200));

// Addresses & CC data for the dropdowns
app.get('/ng2/reactiveForms/userData/addresses', function (req, res, next) {
    res.json([
        '123 Anywhere St.',
        '555 Reactive Row'
    ]);
});

app.get('/ng2/reactiveForms/userData/creditCards', (req, res, next) => {
    res.json(['1234 MasterCard', '5678 Visa']);
});

app.get('/api/reactiveForms/addressCheck/:username', (req, res, next) => res.json({ validAddress: true }));

app.get('/api/reactiveForms/user/save', (req, res, next) => res.json({ success: true }));

app.listen(3000)