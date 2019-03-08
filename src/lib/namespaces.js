const namespaces = require('prefix-ns').asMap();
namespaces.storage = 'http://example.org/storage/';
namespaces.chat = 'http://purl.org/NET/rdfchess/ontology/';

module.exports = namespaces;