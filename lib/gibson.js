/*
 * Copyright (c) 2013, Simone Margaritelli <evilsocket at gmail dot com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *   * Redistributions of source code must retain the above copyright notice,
 *     this list of conditions and the following disclaimer.
 *   * Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *   * Neither the name of Gibson nor the names of its contributors may be used
 *     to endorse or promote products derived from this software without
 *     specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
var util = require('util'),
    net = require('net');

Protocol = {
    header_size: 7,

    opcodes: {
        OP_SET     : 1,
        OP_TTL     : 2,
        OP_GET     : 3,
        OP_DEL     : 4,
        OP_INC     : 5,
        OP_DEC     : 6,
        OP_LOCK    : 7,
        OP_UNLOCK  : 8,
        OP_MSET    : 9,
        OP_MTTL    : 10,
        OP_MGET    : 11,
        OP_MDEL    : 12,
        OP_MINC    : 13,
        OP_MDEC    : 14,
        OP_MLOCK   : 15,
        OP_MUNLOCK : 16,
        OP_COUNT   : 17,
        OP_STATS   : 18,
        OP_PING    : 19,
        OP_META    : 20,
        OP_END     : 0xFF
    },

    replies: {
        REPL_ERR 		   : 0,
        REPL_ERR_NOT_FOUND : 1,
        REPL_ERR_NAN 	   : 2,
        REPL_ERR_MEM	   : 3,
        REPL_ERR_LOCKED    : 4,
        REPL_OK  		   : 5,
        REPL_VAL 		   : 6,
        REPL_KVAL		   : 7
    },

    encodings: {
        // the item is in plain encoding and data points to its buffer
        GB_ENC_PLAIN  : 0x00,
        // PLAIN but compressed data with lzf
        GB_ENC_LZF    : 0x01,
        // the item contains a number and data pointer is actually that number
        GB_ENC_NUMBER : 0x02
    }
};

var Client = exports.Client = function(host,port) {
    this.port = port || -1;
    this.host = host || 'localhost';
    this.buffer = null;
    this.conn = null;
    this.sends = 0;
    this.replies = 0;
    this.callbacks = [];
};

util.inherits(Client, process.EventEmitter);

Client.prototype.connect = function () {
	if (!this.conn) {
        // tcp socket
        if( this.port > 0 ){
	        this.conn = new net.createConnection(this.port, this.host);
        }
        // unix socket
        else {
            this.conn = new net.createConnection(this.host);
        }

		var self = this;

	    this.conn.on('connect', function () {
	        this.setTimeout(0);          // try to stay connected.
	        this.setNoDelay();
		  	self.emit('connect');
	    });

	    this.conn.on('data', function (chunk) {
            if( self.buffer === null )
                self.buffer = chunk;
            else
	    	    self.buffer += chunk;
	    	
            self.recieves += 1;
	    	self.onReplyChunk();
	    });

	    this.conn.on('end', function () {
            console.log( 'on end');
	    	if (self.conn && self.conn.readyState) {
	    		self.conn.end();
	        	self.conn = null;
	      	}
	    });

	    this.conn.on('close', function () {
	    	self.conn = null;
	      	self.emit('close');
	    });

        this.conn.on('timeout', function () {
            self.conn = null;
            self.emit('timeout');
        });

        this.conn.on('error', function (ex) {
            self.conn = null;
            self.emit('error', ex);
        });
    }
};

Client.prototype.decode = function( code, encoding, size, data ){
    var buffer = new Buffer(data);

    if( code === Protocol.replies.REPL_VAL )
    {
        if( encoding === Protocol.encodings.GB_ENC_PLAIN ){
            return buffer.toString();
        }
        else if( encoding === Protocol.encodings.GB_ENC_NUMBER ){
            // 64 bit signed long
            if( size == 8 ){
                // TODO
                return buffer.readInt32LE(0); // data;
            }
            // 32 bit signed integer
            else {
                return buffer.readInt32LE(0);
            }
        }
        else
            this.emit('error','Unknown encoding');
    }
    else if( code === Protocol.replies.REPL_KVAL )
    {
        var obj = {}, count = 0, i, offset, klen, key, enc, vsize, v;

        count = buffer.readUInt32LE(0);

        for( i = 0, offset = 4; i < count; i++ ){
            klen  = buffer.readUInt32LE(offset);                      offset += 4;
            key   = buffer.toString( 'utf8', offset, offset + klen ); offset += klen;
            enc   = buffer.readUInt8(offset);               offset += 1;
            vsize = buffer.readUInt32LE(offset);            offset += 4;
            
            v = new Buffer(vsize);
            
            buffer.copy( v, 0, offset, offset + vsize ); offset += vsize;

            obj[key] = this.decode( Protocol.replies.REPL_VAL, enc, vsize, v );
        }

        return obj;
    }
    else
        return data;
};

Client.prototype.onReplyChunk = function() {
    // console.log( this.buffer );
    var bsize = 0, packet_size = 0, left = 0;

    while ( ( bsize = this.buffer.length ) > 0 ){
        // not enough data
        if( bsize < Protocol.header_size )
            break;

        b = new Buffer( this.buffer );

        var code     = b.readUInt16LE(0);
        var encoding = b.readUInt8(2);
        var datalen  = b.readUInt32LE(3);

        packet_size = Protocol.header_size + datalen;
        left        = bsize - packet_size;

        // do we have a full response packet ?
        if( left >= 0 ){
            // remove the header and keep only raw data
            var data = new Buffer(datalen);
            
            b.copy( data, 0, Protocol.header_size );

            data = this.decode( code, encoding, datalen, data );

            var callback = this.callbacks.shift();
            if (callback != null && callback.cb){
                this.replies++;
                callback.cb(data);
            }

            // nothing left to parse, break the loop
            if( left == 0 )
                break;
            // still some data on the buffer, keep parsing
            else { 
                this.buffer = b.slice(packet_size).toString();
            }
        }
        // keep waiting for incoming data
        else
            continue;
	}
};

Client.prototype.close = function() {
	if (this.conn && this.conn.readyState === 'open') {
		this.conn.end();
		this.conn = null;
	}
};

Client.prototype.query = function( opcode, payload, callback ) {
	this.callbacks.push({ op: opcode, cb: callback });
	this.sends++;

    var psize = Buffer.byteLength( payload );
    var b = new Buffer( 4 /* query length */ + 2 /* opcode */ + psize );

    b.writeUInt32LE( 2 + psize, 0 );
    b.writeUInt16LE( opcode,    4 );
    b.write( payload, 6, psize );

    this.conn.write(b);
};



Client.prototype.set = function( key, value, ttl, cb ){
    this.query( Protocol.opcodes.OP_SET, [ttl, key, value].join(' '), cb );
};

Client.prototype.inc = function( key, cb ){
    this.query( Protocol.opcodes.OP_INC, key, cb );
};

Client.prototype.get = function( key, cb ){
    this.query( Protocol.opcodes.OP_GET, key, cb );
};

Client.prototype.stats = function(cb){
    this.query( Protocol.opcodes.OP_STATS, '', cb );
};

Client.prototype.ping = function(cb){
    this.query( Protocol.opcodes.OP_PING, '', cb );
};

Client.prototype.quit = function(cb){
    this.query( Protocol.opcodes.OP_END, '', cb );
};

// TODO: Map other operators
