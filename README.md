node.js Gibson client
========================

A pure-JavaScript Gibson client library for node.

<http://gibson-db.in/>

Connection
----------

Create a Client object to start working.
Host and port can be passed to the constructor with a connection string, both for tcp and unix sockets.

	var gibson = require('./gibson');

	var unix_client = new gibson.Client('unix:///var/run/gibson.sock');
    var tcp_client = new gibson.Client('tcp://127.0.0.1:10128');

The Client object constructor has three more optional parameters, a connection timeout ( default to infinite ), a boolean flag
which specifies if the tcp no delay flag should be used on the socket ( default to true ), and a string with a custom encoding
to be used while decoding data ( default to utf8 ), so the following line:

    var client = new gibson.Client( 'tcp://127.0.0.1:10128', 100, true, 'ascii' );

Will create a client instance bound to a tcp socket, with a 100ms timeout, the tcp no delay flag set and that will use plain 
ascii encoding on incoming data.

Events
------

The Client object emits 4 important events - connect, close, timeout and error.

	client.on('connect', function(){
		// no arguments - we've connected
	});

	client.on('close', function(){
		// no arguments - connection has been closed
	});

	client.on('timeout', function(){
		// no arguments - socket timed out
	});

	client.on('error', function(e){
		// there was an error - exception is 1st argument
	});
	
	// connect to the Gibson server after subscribing to some or all of these events
	client.connect();

Methods
-------

After connecting, you can start to make requests.

	client.get('key', function(error, result){

		// all of the callbacks have two arguments, the first one will be
        // null if no error occurred, the second one will contain the decoded
        // data ( if any ) received from the server.

	});

	client.set( 3600, 'key', 'value', function(error, result){

		// create ( or replace ) a value with a TTL of 3600 seconds.
        // set the TTL to zero and the value will never expire.

	});

	client.del('key', function(error, result){

		// delete a key from cache.
	});

	client.stats(function(error, result)){

		// grab the server statistics
	});

Every available command is automatically mapped to a client method, so follow the 
[official reference](http://gibson-db.in/commands.php) of Gibson commands.

Once you're done, close the connection.

	client.close();

License
---

Released under the BSD license.  
Copyright &copy; 2013, Simone Margaritelli <evilsocket@gmail.com>  
All rights reserved.
