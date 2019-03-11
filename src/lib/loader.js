const N3 = require('n3');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const Q = require('q');
const streamify = require('streamify-array');
const namespaces = require('./namespaces');
const SemanticChat = require('./semanticchat');

/**
 * The Loader allows creating a Semantic Chess instance via information loaded from an url.
 */
class Loader {

  /**
   * This constructor creates an instance of Loader.
   * @param fetch: the function used to fetch the data
   */
  constructor(fetch) {
    this.engine = newEngine();
    this.fetch = fetch;
  }
  
  async loadFromUrl(chatUrl, userWebId, messageBaseUrl) {
    const rdfjsSource = await this._getRDFjsSourceFromUrl(chatUrl);
    const sources = [{type: 'rdfjsSource', value: rdfjsSource}];
    const interlocutorWebId = await this.findWebIdOfInterlocutor(chatUrl, userWebId);
	//console.log(interlocutorWebId);

    const lastMessage = new SemanticChat({
      url: chatUrl,
      messageBaseUrl,
      userWebId,
      interlocutorWebId
    });

    const messages = await this._findMessage(chatUrl);

    messages.forEach(message => {
      lastMessage.loadMessage(message.messagetext, {url: message.url});
    });

    return lastMessage;
  }
	
  async findWebIdOfInterlocutor(gameUrl, userWebId) {
        const deferred = Q.defer();

        const rdfjsSource = await this._getRDFjsSourceFromUrl(gameUrl);

        this.engine.query(`SELECT ?id { ?agentRole <${namespaces.rdf}type> ?playerRole;
                   <${namespaces.chess}performedBy> ?id.
                MINUS {?playerRole <${namespaces.chess}performedBy> <${userWebId}> .}} LIMIT 100`,
            {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
            .then(function (result) {
                result.bindingsStream.on('data', function (data) {
                    const id = data.toObject()['?id'].value;

                    if (id !== userWebId) {
                        deferred.resolve(id);
                    }
                });

                result.bindingsStream.on('end', function () {
                    deferred.resolve(null);
                });
            });

        return deferred.promise;
    }
  
  _getRDFjsSourceFromUrl(url) {
    const deferred = Q.defer();

    this.fetch(url)
      .then(async res => {
        if (res.status === 404) {
          deferred.reject(404);
        } else {
          const body = await res.text();
          const store = N3.Store();
          const parser = N3.Parser({baseIRI: res.url});

          parser.parse(body, (err, quad, prefixes) => {
            if (err) {
              deferred.reject();
            } else if (quad) {
              store.addQuad(quad);
            } else {
              const source = {
                match: function(s, p, o, g) {
                  return streamify(store.getQuads(s, p, o, g));
                }
              };

              deferred.resolve(source);
            }
          });
        }
      });

    return deferred.promise;
  }
 
	
	async _getObjectFromPredicateForResource(url, predicate) {
    const deferred = Q.defer();
    const rdfjsSource = await this._getRDFjsSourceFromUrl(url);
    const engine = newEngine();

    engine.query(`SELECT ?o {
    <${url}> <${predicate}> ?o.
  }`,
      {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          data = data.toObject();

          deferred.resolve(data['?o']);
        });

        result.bindingsStream.on('end', function () {
          deferred.resolve(null);
        });
      });

    return deferred.promise;
  }
  
    async _findMessage(messageUrl) {
    const deferred = Q.defer();
    let results = [];

    const rdfjsSource = await this._getRDFjsSourceFromUrl(messageUrl);
    let nextMoveFound = false;

    this.engine.query(`SELECT * {
      OPTIONAL { <${messageUrl}> <${namespaces.schema}text> message. }
    } LIMIT 100`,
      {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
      .then(result => {
        result.bindingsStream.on('data', async data => {
          data = data.toObject();

          if (data['message']) {
            results.push({
              messagetext: data['message'].value,
              url: messageUrl
            });
          }

          deferred.resolve(results);
        });

        result.bindingsStream.on('end', function () {
          if (!nextMoveFound) {
            deferred.resolve(results);
          }
        });
      });

    return deferred.promise;
  }
	
	

}

module.exports = Loader;
