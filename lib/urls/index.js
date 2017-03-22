"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildUrlsFromConfig;
function getHubpressUrl(meta, windowLocation) {
  var url = windowLocation.protocol + "//" + windowLocation.host;

  if (windowLocation.hostname === "localhost") {
    console.log("Local development");
    return url;
  }

  if (windowLocation.host === meta.username + ".github.io" || windowLocation.host === meta.username + ".github.com") {
    if (meta.branch !== "master") {
      url = url + "/" + meta.repositoryName;
    }
  } else {
    if (meta.branch !== "master" && (!meta.cname || meta.cname === "")) {
      url = url + "/" + meta.repositoryName;
    }
  }

  return url;
}

function getSiteUrl(meta, addProtocol) {
  var url = void 0;
  // TODO change that
  if (meta.cname && meta.cname !== '') {
    url = (addProtocol === false ? '' : 'http:') + '//' + meta.cname;
  } else {
    url = (addProtocol === false ? '' : 'https:') + ("//" + meta.username + ".github.io");
    if (meta.branch !== 'master') {
      url = url + '/' + meta.repositoryName;
    }
  }

  return url;
}

function buildUrlsFromConfig(config) {
  return {
    site: getSiteUrl(config.meta),
    hubpress: getHubpressUrl(config.meta, window.location),
    theme: getSiteUrl(config.meta, false) + ("/themes/" + config.theme.name),
    images: getSiteUrl(config.meta) + '/images',
    getPostUrl: function getPostUrl(postName) {
      return postName.replace(/([\d]{4})-([\d]{2})-([\d]{2})-([\w-]*)\.adoc/, '/$1/$2/$3/$4.html');
    },
    getPostGhPath: function getPostGhPath(postName) {
      return postName.replace(/([\d]{4})-([\d]{2})-([\d]{2})-([\w-]*)\.adoc/, '$1/$2/$3/$4.html');
    },
    getSiteUrl: getSiteUrl
  };
}