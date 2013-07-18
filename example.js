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
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS 'AS IS'
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
var util = require('util');
var Gibson = require('./lib/gibson');

function microtime() {  
    return new Date().getTime() / 1000; 
}

var benchmark = function() {
	var count = 100000;
    var delta, start = microtime(true);
	var x = 0;

    console.log( 'Starting benchmark ...' );

	for (var i = 1; i <= count; i++) {
		c.get( 'foo', function( err, data ) {
            if( data != 'bar' ){
                console.log( 'Unexpected data "' + data + '" ( error: "' + err + '" )' ); 
            }

			x += 1;
        
            if( x == count ){
                delta = microtime(true) - start;
                
                console.log( 'Benchmark finished: ' + ( x / delta ).toFixed(2)  + 
                             ' requests/second ( time: ' + delta.toFixed(2)  + ' s )' );

                c.stats( function(e,d){
                    c.del( 'foo', function(){
                        console.log();
                        
                        for( var key in d ){
                            console.log( key + ' : ' + d[key] );
                        }

                        console.log();

                        c.close();
                    });
                });
            }
		});
	}
};

var c = new Gibson.Client( 'unix:///var/run/gibson.sock' );

console.log( 'Connecting ...' );


c.on( 'connect', function(){
    // SET 0 foo bar
    c.set( 0, 'foo', 'bar', function(e,d){
        console.log( 'set reply: ' + d );
        // GET foo
        c.get( 'foo', function(e,d){
            console.log( 'get reply: ' + d );
            // PING
            c.ping( function(){
                console.log( 'got ping reply' );
                benchmark(); 
            });
        }); 
    });
});

c.connect();

c.on( 'error', function(e){
    console.log( 'ERROR: ' + e );
});

c.on( 'close', function(){
    console.log( 'Connection closed.' );
});

c.on( 'timeout', function(){
    console.log( 'Connection timed out.' );
});
