const N3 = require('n3');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const namespaces = require('./namespaces');
const uniqid = require('uniqid');
const winston = require('winston');
const URI = require('uri-js');
const {format} = require('date-fns');
const rdfjsSourceFromUrl = require('./rdfjssourcefactory').fromUrl;

class DeChatCore {

  constructor(fetch) {
    this.inboxUrls = {};
    this.fetch = fetch;
    this.alreadyCheckedResources = [];
    this.logger = winston.createLogger({
      level: 'error',
      transports: [
        new winston.transports.Console(),
      ],
      format: winston.format.cli()
    });
  };

  /**
   * This method returns a formatted name for a WebId.
   * @param webid: the WebId for which a formatted name needs to be created.
   * @returns {Promise<string|null>}: a promise that resolvew with the formatted name (string) or
   * null if no name details were found.
   */
  async getFormattedName(webid) {
    let formattedName = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'name');

    if (!formattedName) {
      formattedName = null;
      const firstname = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'givenName');
      const lastname = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'lastName');

      if (firstname) {
        formattedName = firstname;
      }

      if (lastname) {
        if (formattedName) {
          formattedName += ' ';
        } else {
          formattedName = '';
        }

        formattedName += lastname;
      }

      if (!formattedName) {
        formattedName = webid;
      }
    } else {
      formattedName = formattedName.value;
    }

    return formattedName;
  }
}
module.exports = DeChatCore;
