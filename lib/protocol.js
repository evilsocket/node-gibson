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
var Opcodes = {
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
    OP_KEYS    : 21,
    OP_END     : 0xFF
};

var Commands = {
    'SET'     : Opcodes.OP_SET,
    'TTL'     : Opcodes.OP_TTL,
    'GET'     : Opcodes.OP_GET,
    'DEL'     : Opcodes.OP_DEL,
    'INC'     : Opcodes.OP_INC,
    'DEC'     : Opcodes.OP_DEC,
    'LOCK'    : Opcodes.OP_LOCK,
    'UNLOCK'  : Opcodes.OP_UNLOCK,
    'MSET'    : Opcodes.OP_MSET,
    'MTTL'    : Opcodes.OP_MTTL,
    'MGET'    : Opcodes.OP_MGET,
    'MDEL'    : Opcodes.OP_MDEL,
    'MINC'    : Opcodes.OP_MINC,
    'MDEC'    : Opcodes.OP_MDEC,
    'MLOCK'   : Opcodes.OP_MLOCK,
    'MUNLOCK' : Opcodes.OP_MUNLOCK,
    'COUNT'   : Opcodes.OP_COUNT,
    'STATS'   : Opcodes.OP_STATS,
    'PING'    : Opcodes.OP_PING,
    'META'    : Opcodes.OP_META,
    'KEYS'    : Opcodes.OP_KEYS,
    'END'     : Opcodes.OP_END
};

var Replies = {
    REPL_ERR 		   : 0, // Generic error
    REPL_ERR_NOT_FOUND : 1, // Key/Prefix not found
    REPL_ERR_NAN 	   : 2, // Not a number
    REPL_ERR_MEM	   : 3, // Out of memory
    REPL_ERR_LOCKED    : 4, // Object is locked
    REPL_OK  		   : 5, // Ok, no data follows
    REPL_VAL 		   : 6, // Ok, scalar value follows
    REPL_KVAL		   : 7  // Ok, [ key => value, ... ] follows
};

var Errors = [
    'Generic error.',
    'Key/prefix not found.',
    'Invalid data ( Not a Number ).',
    'Server is out of memory.',
    'The object is locked.'
];

var Encodings = {
    GB_ENC_PLAIN  : 0x00, // the item is in plain encoding and data points to its buffer
    GB_ENC_LZF    : 0x01, // PLAIN but compressed data with lzf
    GB_ENC_NUMBER : 0x02  // the item contains a number and data pointer is actually that number
};

var Protocol = exports.Protocol = {
    header_size: 7,

    opcodes   : Opcodes,
    commands  : Commands,
    replies   : Replies,
    errors    : Errors,
    encodings : Encodings,

    isErrorCode: function(code){
        return ( code >= Replies.REPL_ERR && code <= Replies.REPL_ERR_LOCKED );
    }
};
