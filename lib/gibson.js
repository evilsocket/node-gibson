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

var Client = exports.Client = function(connectionString) {
    connectionString = connectionString || 'unix:///var/run/gibson.sock';
    
    var parsed = url.parse(connectionString);

    this.port = parsed.port || -1; 
    this.host = parsed.hostname || parsed.path;
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
    // console.log( 'decode code = ' + code + ', encoding = ' + encoding + ' size = ' + size );

    if( code === Protocol.replies.REPL_VAL )
    {
        if( encoding === Protocol.encodings.GB_ENC_PLAIN ){
            return data.toString();
        }
        else if( encoding === Protocol.encodings.GB_ENC_NUMBER ){
            var buffer = new Buffer(data);

            // 64 bit signed long
            if( size == 8 ){
                /*
                 * NOTE:
                 * Javascript uses internally 64 bit floating numbers, wich means you 
                 * can only represent exactly numbers up to 2^53, or 9007199254740992.
                 */
                var word0 = buffer.readUInt32LE(0);
                var word1 = buferf.readUInt32LE(4);
                
                if (!(word1 & 0x80000000))
                    return word0 + 0x100000000 * word1;

                else
                    return -((((~word1)>>>0) * 0x100000000) + ((~word0)>>>0) + 1);
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
        var buffer = new Buffer(data);
        var obj = {}, count = 0, i, offset, klen, key, enc, vsize, v;

        count = buffer.readUInt32LE(0);

        for( i = 0, offset = 4; i < count; i++ ){
            // four bytes, unsigned int 32 bit of key length
            klen    = buffer.readUInt32LE(offset);                     
            offset += 4;
            // 'key length' bytes of the key
            key     = buffer.toString( 'utf8', offset, offset + klen );
            offset += klen;
            // one unsigned byte of encoding
            enc     = buffer.readUInt8(offset);               
            offset += 1;
            // four bytes, unsigned int 32 bit of data size
            vsize   = buffer.readUInt32LE(offset);            
            offset += 4;
            // 'vsize' bytes of value
            v = new Buffer(vsize);
            
            buffer.copy( v, 0, offset, offset + vsize ); 
            offset += vsize;

            obj[key] = this.decode( Protocol.replies.REPL_VAL, enc, vsize, v );
        }

        return obj;
    }
    else
        return data;
};

Client.prototype.onReplyChunk = function() {
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
            this.replies++;

            // remove the header and keep only raw data
            var data = new Buffer(datalen);
            
            b.copy( data, 0, Protocol.header_size );

            data = this.decode( code, encoding, datalen, data );
                
            var callback = this.callbacks.shift();
            if( callback != null && callback.cb ){
                var err = undefined;

                if( Protocol.isErrorCode(code) ){
                    err = new Error( Protocol.errors[code] );
                }

                callback.cb( err, data );
            }

            this.buffer = b.slice(packet_size).toString();

            // nothing left to parse, break the loop
            if( this.buffer.length <= 0 ) {
                // console.log( 'no more data' );
                break;
            }
            /*
            else
                console.log( 'still more data ' + this.buffer.length );
            */
        }
        // keep waiting for incoming data
        else
            continue;
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
    
	this.callbacks.push({ op: opcode, cb: callback });
	this.sends++;

    var psize = Buffer.byteLength( payload );
    var b = new Buffer( 4 /* query length */ + 2 /* opcode */ + psize );

    b.writeUInt32LE( 2 + psize, 0 );
    b.writeUInt16LE( opcode,    4 );
    b.write( payload, 6, psize );

    this.conn.write(b);
};

function to_array(args) {
    for( var i = 0, len = args.length, arr = new Array(len); i < len; i += 1 ){
        arr[i] = args[i];
    }

    return arr;
}

Client.prototype.set = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_SET, args.join(' '), cb );
};


Client.prototype.ttl = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_TTL, args.join(' '), cb );
};


Client.prototype.get = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_GET, args.join(' '), cb );
};


Client.prototype.del = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_DEL, args.join(' '), cb );
};


Client.prototype.inc = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_INC, args.join(' '), cb );
};


Client.prototype.dec = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_DEC, args.join(' '), cb );
};


Client.prototype.lock = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_LOCK, args.join(' '), cb );
};


Client.prototype.unlock = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_UNLOCK, args.join(' '), cb );
};


Client.prototype.mset = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MSET, args.join(' '), cb );
};


Client.prototype.mttl = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MTTL, args.join(' '), cb );
};


Client.prototype.mget = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MGET, args.join(' '), cb );
};


Client.prototype.mdel = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MDEL, args.join(' '), cb );
};


Client.prototype.minc = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MINC, args.join(' '), cb );
};


Client.prototype.mdec = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MDEC, args.join(' '), cb );
};


Client.prototype.mlock = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MLOCK, args.join(' '), cb );
};


Client.prototype.munlock = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_MUNLOCK, args.join(' '), cb );
};


Client.prototype.count = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_COUNT, args.join(' '), cb );
};


Client.prototype.stats = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_STATS, args.join(' '), cb );
};


Client.prototype.ping = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_PING, args.join(' '), cb );
};


Client.prototype.meta = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_META, args.join(' '), cb );
};


Client.prototype.end = function(){
  var args = to_array(arguments);
  var cb   = undefined;
  if( typeof( args[ args.length - 1 ] ) == 'function' ){
      cb = args.pop();
  }
  return this.query( Protocol.opcodes.OP_END, args.join(' '), cb );
};

/*
var lwr, opcode = '';

for( var name in Protocol.commands ){
    lwr    = name.toLowerCase();
    opcode = Protocol.commands[name];

    console.log( 'Client.prototype.' + lwr + ' = function(){\n' +
                 '  var args = to_array(arguments);\n' +
                 '  var cb   = undefined;\n' +
                 '  if( typeof( args[ args.length - 1 ] ) == \'function\' ){\n' +
                 '      cb = args.pop();\n' + 
                 '  }\n'+   
                 '  return this.query( Protocol.opcodes.OP_' + name + ', args.join(\' \'), cb );\n' +
                 '};\n\n' );
}
*/
