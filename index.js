'use strict';

const util = require('util'),
    Imap = require('imap'),
    debug = require('debug'),
    MailParser = require('mailparser').MailParser,
    simpleParser = require('mailparser').simpleParser,
    EventEmitter = require('events').EventEmitter;

var dbg = debug('mailreceive');

function MailReceive(opts, dbg) {
    EventEmitter.call(this);
    var self = this;
    self.options = opts;
    if (self.options.username) {
        self.options.user = self.options.username;
    }
    self.options.box = self.options.box || 'INBOX';
    self.options.debug = self.options.debug || debug('imap');

    if (dbg) {
        self.dbg = dbg;
    }
}

util.inherits(MailReceive, EventEmitter);

module.exports = function (opts, customDbg) {
    return new MailReceive(opts, customDbg);
};

MailReceive.prototype.start = function () {
    var self = this;
    self.imap = new Imap(self.options);
    self.imap.once('end', function () {
        self.dbg('imap end');
        self.emit('end');
    });
    self.imap.once('error', function (err) {
        self.dbg('imap error : %s', err);
        self.emit('error', err);
    });
    self.imap.once('close', function (haserr) {
        self.dbg('imap close : %s', haserr ? 'errored' : 'normal');
    });
    self.imap.on('uidvalidity', function (uidvalidity) {
        self.dbg('new uidvalidity : %s', uidvalidity);
    });
    self.imap.once('ready', function () {
        self.emit('connected');
        self.imap.openBox(self.options.box, false, function (err, box) {
            if (err) {
                self.dbg('unable to open box : %s', err);
                self.emit('error', err);
                return;
            }
            self.scan();
            self.imap.on('mail', function (id) {
                self.dbg('mail event : %s', id);
                self.scan();
            });
        });
    });
    self.imap.connect();
    return this;
};

MailReceive.prototype.scan = function () {

    var self = this, search = self.options.search || ['UNSEEN'];

    self.dbg('scanning %s with filter `%s`.', self.options.box, search);
    self.imap.search(search, function (err, seachResults) {
        if (err) {
            self.emit('error', err);
            return;
        }
        if (!seachResults || seachResults.length === 0) {
            self.dbg('no new mail in %s', self.options.box);
            return;
        }
        self.dbg('found %d new messages', seachResults.length);
        var fetch = self.imap.fetch(seachResults, {
            markSeen: self.options.markSeen !== false,
            bodies: ''
        });
        fetch.on('message', function (msg, seqno) {
            msg.once('body', function (stream, info) {
                simpleParser(stream).then(mail => {
                    self.emit('mail', mail);
                }).catch(err => {
                    console.log(err)
                })
            });
        });
        fetch.once('end', function () {
            self.dbg('Done fetching all messages!');
        });
        fetch.once('error', function (err) {
            self.dbg('fetch error : ', err);
            self.emit('error', err);
        });
    });
    return this;
};

MailReceive.prototype.stop = function () {
    var self = this;
    self.dbg('imap.state before stopping: %s', this.imap.state);

    if (this.imap.state !== 'disconnected') {
        this.imap.end();
    }

    self.dbg('MailReceive stopped');
    return this;
};

MailReceive.prototype.dbg = function (...args) {
    dbg(...args);
}
