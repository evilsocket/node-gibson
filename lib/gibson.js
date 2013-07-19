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
    net = require('net'),
    url = require('url'),
    Protocol = require('./protocol').Protocol;

var Client = exports.Client = function(connection) {
    var parsed = url.parse( connection || 'unix:///var/run/gibson.sock' );

    this.port      = parsed.port || -1; 
    this.host      = parsed.hostname || parsed.path;
    this.buffer    = null;
    this.conn      = null;
    this.callbacks = [];
};

util.inherits(Client, process.EventEmitter);

Client.prototype.append_chunk = function( chunk ){
    if( this.buffer == null ) {
        this.buffer = chunk;
    }
    else {
        // check for concat
        if( Buffer.concat !== undefined ){
            this.buffer = Buffer.concat([this.buffer, chunk]);
        } 
        else {
            var tmp = new Buffer( this.buffer.length + chunk.length );

            this.buffer.copy( tmp, 0 );
            chunk.copy( tmp, this.buffer.length );

            this.buffer = tmp;
        }
    }
};

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
	        // TODO: Make those values customizables
            this.setTimeout(0);     
	        this.setNoDelay();
		  	self.emit('connect');
	    });

	    this.conn.on('data', function (chunk) {
            self.append_chunk(chunk);
            self.handle_incoming_data();
	    });

	    this.conn.on('end', function () {
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

Client.prototype.decode = function( code, encoding, size, data, offset ){
    // console.log( 'decode code = ' + code + ', encoding = ' + encoding + ' size = ' + size );

    if( code === Protocol.replies.REPL_VAL )
    {
        if( encoding === Protocol.encodings.GB_ENC_PLAIN ){
            // TODO: Make the user specify the encoding.
            return data.slice(offset, offset + size).toString();
        }
        else if( encoding === Protocol.encodings.GB_ENC_NUMBER ){
            // 64 bit signed long
            if( size == 8 ){
                /*
                 * NOTE:
                 * Javascript uses internally 64 bit floating numbers, wich means you 
                 * can only represent exactly numbers up to 2^53, or 9007199254740992.
                 */
                var word0 = data.readUInt32LE(offset);
                var word1 = data.readUInt32LE(offset + 4);
                
                if (!(word1 & 0x80000000))
                    return word0 + 0x100000000 * word1;

                else
                    return -((((~word1)>>>0) * 0x100000000) + ((~word0)>>>0) + 1);
            }
            // 32 bit signed integer
            else {
                return data.readInt32LE(offset);
            }
        }
        else
            this.emit('error','Unknown encoding');
    }
    else if( code === Protocol.replies.REPL_KVAL )
    {
        var obj = {}, count = 0, i, klen, key, enc, vsize, v;

        count = data.readUInt32LE(offset);

        for( i = 0, offset = offset + 4; i < count; i++ ){
            // four bytes, unsigned int 32 bit of key length
            klen    = data.readUInt32LE(offset);                     
            offset += 4;
            // 'key length' bytes of the key
            // TODO: Make the user specify the encoding.
            key     = data.toString( 'utf8', offset, offset + klen );
            offset += klen;
            // one unsigned byte of encoding
            enc     = data.readUInt8(offset);               
            offset += 1;
            // four bytes, unsigned int 32 bit of data size
            vsize   = data.readUInt32LE(offset);            
            offset += 4;
            // 'vsize' bytes of value
            obj[key] = this.decode( Protocol.replies.REPL_VAL, enc, vsize, data, offset );
            offset += vsize;
        }

        return obj;
    }
    else
        return data;
};

// if a callback throws an exception, re-throw it on a new stack so the parser can keep going.
// put this try/catch in its own function because V8 doesn't optimize this well yet.
function safe_callback(callback, error, data) {
    try {
        callback(error, data);
    } catch (err) {
        process.nextTick(function () {
            throw err;
        });
    }
}

Client.prototype.handle_incoming_data = function() {
    var bsize = 0, packet_size = 0, left = 0, 
        packet, code, encoding, datalen, data,
        callback, err;

    // keep parsing while we have at least a header to read
    while ( ( bsize = this.buffer.length ) >= Protocol.header_size ){
        code     = this.buffer.readUInt16LE(0);
        encoding = this.buffer.readUInt8(2);
        datalen  = this.buffer.readUInt32LE(3);

        packet_size = Protocol.header_size + datalen;
        
        // do we have a full response packet ?
        if( bsize >= packet_size ){
            // decode raw data
            data = this.decode( code, encoding, datalen, this.buffer, Protocol.header_size );
            // execute user callback if specified    
            callback = this.callbacks.shift();
            if( callback != null ){
                err = null;
                if( Protocol.isErrorCode(code) ){
                    err = new Error( Protocol.errors[code] );
                }

                safe_callback( callback, err, data );
            }
            
            // go to the next packed if available
            this.buffer = this.buffer.slice( packet_size );
        }
	}
};

Client.prototype.close = function() {
	if( this.conn && this.conn.readyState === 'open' ) {
		this.conn.end();
		this.conn = null;
	}
};

Client.prototype.query = function( opcode, payload, callback ) {
    // console.log( 'query( ' + opcode + ', "' + payload + '", cb )' );
    this.callbacks.push(callback);

    var psize  = Buffer.byteLength( payload );
    var packet = new Buffer( 4 /* query length */ + 2 /* opcode */ + psize );

    packet.writeUInt32LE( 2 + psize, 0 );
    packet.writeUInt16LE( opcode,    4 );
    packet.write( payload, 6, psize );

    this.conn.write(packet);
};

function to_array(args) {
    for( var i = 0, len = args.length, arr = new Array(len); i < len; i += 1 ){
        arr[i] = args[i];
    }

    return arr;
}

// auto map every command prototype using the protocol definition
Object.keys( Protocol.commands ).forEach( function(cmd){
    var lwr    = cmd.toLowerCase(),
        opcode = Protocol.commands[cmd]; 
    
    Client.prototype[cmd] = 
    Client.prototype[lwr] = function(){
        var args = to_array(arguments), cb = undefined;

        if( args.length && typeof(args[ args.length - 1 ]) == 'function' ){
            cb = args.pop();
        }

        return this.query( opcode, args.join(' '), cb );
    };
});
