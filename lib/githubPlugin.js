'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.githubPlugin = githubPlugin;

var _platform = require('platform');

var _platform2 = _interopRequireDefault(_platform);

var _isomorphicFetch = require('isomorphic-fetch');

var _isomorphicFetch2 = _interopRequireDefault(_isomorphicFetch);

var _hubpressCoreSlugify = require('hubpress-core-slugify');

var _hubpressCoreSlugify2 = _interopRequireDefault(_hubpressCoreSlugify);

var _githubApi = require('github-api');

var _githubApi2 = _interopRequireDefault(_githubApi);

var _q = require('q');

var _q2 = _interopRequireDefault(_q);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _urls = require('./urls');

var _urls2 = _interopRequireDefault(_urls);

var _InitConfig = require('./components/InitConfig');

var _InitConfig2 = _interopRequireDefault(_InitConfig);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var TREE_CHUNK_SIZE = 50;

function getRepositoryInfos(repository) {
  var deferred = _q2.default.defer();

  repository.getDetails(function (err, informations) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(informations);
    }
  });

  return deferred.promise;
}

function getAuthorizations(authorization) {
  var deferred = _q2.default.defer();

  console.log('getAuthorizations', authorization);
  var options = {};
  authorization.listAuthorizations(options, function (err, list) {
    if (err) {
      deferred.reject(err);
    } else {
      console.log('getAuthorizations list', list);
      deferred.resolve(list);
    }
  });

  return deferred.promise;
}

function getUserInformations(user) {

  return function () {
    var deferred = _q2.default.defer();
    user.getProfile(function (err, informations) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve(_lodash2.default.pick(informations, ['login', 'id', 'name', 'location', 'blog', 'avatar_url', 'bio']));
      }
    });

    return deferred.promise;
  };
}

function getTokenNote(repositoryName) {
  //return S(`hubpress-${platform.name}-${platform.os}`).slugify().s
  return (0, _hubpressCoreSlugify2.default)(repositoryName + '-' + _platform2.default.name + '-' + _platform2.default.os);
}

function _searchAndDeleteAuthorization(repositoryName, authorizations, authorization) {
  var deferred = _q2.default.defer();
  var id = -1;
  var TOKEN_NOTE = getTokenNote(repositoryName);
  authorizations.forEach(function (token) {
    var note = token.note;
    if (note === TOKEN_NOTE) {
      id = token.id;
    }
  });

  if (id !== -1) {
    authorization.deleteAuthorization(id, function (err, values) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve();
      }
    });
  } else {
    deferred.resolve();
  }

  return deferred.promise;
}

function _createAuthorization(repositoryName, authorization) {
  var deferred = _q2.default.defer();
  var definition = {
    scopes: ['public_repo'],
    note: getTokenNote(repositoryName)
  };

  authorization.createAuthorization(definition, function (err, createdToken) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(createdToken);
    }
  });

  return deferred.promise;
}

var githubInstance = void 0;

function login(opts) {
  console.log('githubPlugin - login', opts);
  var deferred = _q2.default.defer();
  var credentials = opts.nextState.credentials;
  var meta = opts.rootState.application.config.meta;

  githubInstance = new _githubApi2.default({
    auth: "basic",
    username: credentials.email,
    password: credentials.password,
    twoFactorCode: credentials.twoFactorCode
  });

  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  var authorization = githubInstance.getAuthorization();
  var user = githubInstance.getUser();
  var _informations = void 0;
  var _userInformations = void 0;

  getRepositoryInfos(repository).then(function (informations) {
    _informations = informations;
  }).then(getUserInformations(user)).then(function (userInformations) {
    _userInformations = userInformations;
    return getAuthorizations(authorization);
  }).then(function (authorizations) {
    return _searchAndDeleteAuthorization(meta.repositoryName, authorizations, authorization);
  }).then(function () {
    return _createAuthorization(meta.repositoryName, authorization);
  }).then(function (result) {
    githubInstance = new _githubApi2.default({
      auth: "oauth",
      token: result.token
    });

    deferred.resolve({
      isAuthenticated: true,
      credentials: {
        token: result.token
      },
      permissions: _informations.permissions,
      userInformations: _userInformations
    });
  }).catch(function (error) {
    console.error('githubPlugin - login error', error, error.response);
    var message = {
      type: 'error',
      title: 'Authentication'
    };
    var otpRequired;

    if (error.response) {
      var otp = error.response.headers && error.response.headers['x-github-otp'] || '';
      otpRequired = otp.split(';')[0] === 'required';
    }

    if (otpRequired) {
      // force sms with a post on auth
      _createAuthorization(meta.repositoryName, authorization);

      console.log('githubPlugin - OTP required : ', otpRequired);
      message.type = 'warning';
      message.content = 'A two-factor authentication code is needed.';
      message.otp = true;

      deferred.resolve({
        isAuthenticated: false,
        isTwoFactorCodeRequired: true
      });
    } else {
      console.error('githubPlugin - login error', error);

      deferred.reject({
        error: {
          code: error.error,
          message: 'Unable to authenticate, check your credentials.'
        }
      });
    }
  });

  return deferred.promise;
}

function getGithubPostsSha(repository, config) {

  var deferred = _q2.default.defer();

  repository.getContents(config.meta.branch, '', true, function (err, elements) {
    if (err) {
      deferred.reject(err);
    } else {
      var postsSha = void 0;
      elements.forEach(function (element) {
        if (element.name === '_posts') {
          postsSha = element.sha;
        }
      });
      deferred.resolve(postsSha);
    }
  });

  return deferred.promise;
}

function getPostsGithub(repository, config, sha) {
  var promise = void 0;

  if (sha === localStorage.postsSha) {
    promise = _q2.default.fcall(function () {
      return [];
    });
  } else {
    var deferred = _q2.default.defer();
    repository.getContents(config.meta.branch, '_posts', true, function (err, posts) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve(posts);
      }
    });

    promise = deferred.promise;
  }

  return promise;
}

function markIfPostPublished(config, post) {
  var defer = _q2.default.defer();
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  repository.getSha(config.meta.branch, config.urls.getPostGhPath(post.name), function (err, sha) {
    if (err && err.response && err.response.status !== 404) {
      defer.reject(err);
    } else {
      var isPublished = !!sha ? 1 : 0;
      var _post = Object.assign({}, post, { published: isPublished });
      defer.resolve(_post);
    }
  });

  return defer.promise;
}

function markIfPostsPublished(repository, config, posts) {
  var _posts = _lodash2.default.compact(posts);

  var promises = _posts.map(function (post) {
    return markIfPostPublished(config, post);
  });

  return _q2.default.all(promises);
}

function getPostAuthor(config, post, userInformations) {
  var defer = _q2.default.defer();
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  console.log('getPostAuthor', post);
  repository.listCommits({
    sha: config.meta.branch,
    path: post.original && post.original.path || post.path
  }, function (err, commits) {
    if (err && err.error !== 404) {
      defer.reject(err);
    } else {
      var author = commits[commits.length - 1].author;
      // Sometime author is not defined, in this case we use the authenticated user
      if (!author || author.login === userInformations.login) {
        author = Object.assign({}, userInformations);
        var _post = Object.assign({}, post, { author: author });
        defer.resolve(_post);
      } else {
        var user = githubInstance.getUser(author.login);
        getUserInformations(user)().then(function (userInfos) {
          author = Object.assign({}, userInfos);
          var _post = Object.assign({}, post, { author: author });
          defer.resolve(_post);
        }).catch(function (e) {
          return defer.reject(e);
        });
      }
    }
  });

  return defer.promise;
}

function getPostsAuthor(repository, config, posts, userInformations) {
  var promises = posts.map(function (post) {
    return getPostAuthor(config, post, userInformations);
  });

  return _q2.default.all(promises);
}

function readContent(repository, config, posts) {
  var promises = [];

  posts.forEach(function (post) {
    var deferred = _q2.default.defer();
    promises.push(deferred.promise);

    repository.getContents(config.meta.branch, post.path, true, function (err, content) {
      if (err) {
        deferred.reject(err);
      } else {
        var _post = void 0;
        _post = Object.assign({}, post, {
          content: content
        });

        deferred.resolve(_post);
      }
    });
  });

  return _q2.default.all(promises);
}

function getPosts(state) {
  var config = state.application.config;
  console.log('Get posts', config);
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  return getGithubPostsSha(repository, config).then(function (sha) {
    return getPostsGithub(repository, config, sha);
  }).then(function (posts) {
    return posts.map(function (post) {
      return _lodash2.default.pick(post, ['name', 'path', 'sha', 'size']);
    });
  }).then(function (posts) {
    return markIfPostsPublished(repository, config, posts);
  }).then(function (posts) {
    return getPostsAuthor(repository, config, posts, state.authentication.userInformations);
  }).then(function (posts) {
    return readContent(repository, config, posts);
  });
}

function deleteElement(repository, branch, elementPath) {
  var defer = _q2.default.defer();
  repository.deleteFile(branch, elementPath, function (err, sha) {
    if (err) {
      defer.reject(err);
    } else {
      defer.resolve(sha);
    }
  });
  return defer.promise;
}

// Alias deleteElement
function deletePost(repository, branch, elementPath) {
  return deleteElement(repository, branch, elementPath);
}

function movePostIfNecessary(config, post) {
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  var returnedPromise = void 0;

  // Check if the name has  changed
  if (post.original && post.name !== post.original.name) {
    var defer = _q2.default.defer();
    returnedPromise = defer.promise;

    var branch = config.meta.branch;
    var origin = '_posts/' + post.original.name;
    var dest = '_posts/' + post.name;

    repository.move(branch, origin, dest, function (err, sha) {
      if (err) {
        defer.reject(err);
      } else {
        // if published, then removed
        if (!post.published) {
          defer.resolve({ post: post, sha: sha });
        } else {
          // Remove the post published with the old name
          var oldPublishedPostPath = config.urls.getPostGhPath(post.original.name);

          deletePost(repository, branch, oldPublishedPostPath).then(function (sha) {
            defer.resolve({ post: post, sha: sha });
          }).catch(function (err) {
            defer.reject(err);
          }).done();
        }
      }
    });
  } else {
    returnedPromise = (0, _q2.default)({ post: post });
  }

  return returnedPromise;
}

function writePost(config, post) {
  console.log('Write post', config, post);
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  var branch = meta.branch;
  var postPath = '_posts/' + post.name;
  var commitMessage = 'Update ' + post.name;
  var defer = _q2.default.defer();
  repository.writeFile(branch, postPath, post.content, commitMessage, function (err, sha) {
    if (err) {
      defer.reject(err);
    } else {
      post.original = _lodash2.default.omit(post, ['original']); //Object.assign({}, post)
      post.original.url = config.urls.getPostUrl(post.original.name);
      post.original.path = '_posts/' + post.original.name;
      post.original.sha = sha;
      defer.resolve(post);
    }
  });

  return defer.promise;
}

function writeConfig(config) {
  console.log('Write config', config);
  var defer = _q2.default.defer();
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  var branch = meta.branch;

  repository.writeFile(branch, 'hubpress/config.json', JSON.stringify(config, null, 2), 'Update configuration file', function (err, sha) {
    if (err) {
      defer.reject(err);
    } else {
      defer.resolve(sha);
    }
  });
  return defer.promise;
}

function manageCname(config) {
  console.log('Github manageCname - ', config);
  var meta = config.meta;
  var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  var defer = _q2.default.defer();
  var cb = function cb(err, sha) {
    // not found if we try to delete CNAME that not exist
    // TODO Compare with the previous settings state
    if (err && err !== 'not found') {
      defer.reject(err);
    } else {
      defer.resolve(sha);
    }
  };

  if (!meta.cname || meta.cname === '') {
    console.info('SettingsService - saveAndPublish delete CNAME');
    repository.deleteFile(meta.branch, 'CNAME', cb).then(function (sha) {
      console.log('SHA after delete', sha);
      defer.resolve(sha);
    }).catch(function (err) {
      if (err.response.status !== 404) {
        defer.reject(err);
      } else {
        defer.resolve();
      }
    });
  } else {
    console.info('SettingsService - saveAndPublish save CNAME');
    repository.writeFile(meta.branch, 'CNAME', meta.cname, 'Update CNAME with ' + meta.cname, function (err, sha) {
      if (err) {
        defer.reject(err);
      } else {
        defer.resolve(sha);
      }
    });
  }

  return defer.promise;
}

function githubPlugin(context) {

  context.on('application:request-config', function (opts) {
    console.info('githubPlugin - application:request-config');
    console.log('githubPlugin - application:request-config', opts);
    return (0, _isomorphicFetch2.default)('config.json?dt=' + Date.now()).then(function (req) {
      return req.json();
    }).then(function (config) {
      opts.nextState.config = Object.assign({}, opts.nextState.config, config);
      // TODO remove after 0.6.0
      opts.nextState.config.theme.name = opts.nextState.config.theme.name.toLowerCase();
      return opts;
    });
  });

  context.on('application:receive-config', function (opts) {
    console.info('githubPlugin - application:receive-config');
    console.log('githubPlugin - application:receive-config', opts);
    var urls = (0, _urls2.default)(opts.nextState.config);
    opts.nextState.config = Object.assign({}, opts.nextState.config, { urls: urls });
    return opts;
  });

  context.on('requestAuthentication', function (opts) {
    console.info('githubPlugin - requestAuthentication');
    console.log('githubPlugin - requestAuthentication', opts);
    return login(opts).then(function (result) {
      var credentials = Object.assign({}, opts.nextState.credentials, result.credentials);
      opts.nextState = Object.assign({}, opts.nextState, result, { credentials: credentials });
      return opts;
    });
  });

  context.on('receiveSavedAuth', function (opts) {
    console.info('githubPlugin - receiveSavedAuth');
    console.log('githubPlugin - receiveSavedAuth', opts);
    if (opts.nextState.authentication.isAuthenticated) {
      githubInstance = new _githubApi2.default({
        auth: "oauth",
        token: opts.nextState.authentication.credentials.token
      });
    }
    return opts;
  });

  context.on('hubpress:request-remote-synchronization', function (opts) {
    console.info('githubPlugin - hubpress:request-remote-synchronization');
    console.log('githubPlugin - hubpress:request-remote-synchronization', opts);
    if (!opts.rootState.authentication.isAuthenticated) {
      return opts;
    }
    return getPosts(opts.rootState).then(function (posts) {
      opts.nextState = Object.assign({}, opts.nextState, { posts: posts });
      return opts;
    });
  });

  context.on('requestSaveRemotePost', function (opts) {
    console.info('githubPlugin - requestSaveRemotePost');
    console.log('githubPlugin - requestSaveRemotePost', opts);
    var config = opts.rootState.application.config;
    var post = opts.nextState.post;
    // Move if necessary
    return movePostIfNecessary(config, post).then(function (result) {
      return writePost(config, result.post);
    }).then(function (_post) {
      return getPostAuthor(config, _post, opts.rootState.authentication.userInformations);
    }).then(function (updatedPost) {
      opts.nextState.post = updatedPost;
      return opts;
    });
  });

  context.on('requestSaveRemotePublishedElements', function (opts) {
    console.info('githubPlugin - requestSaveRemotePublishedElements');
    console.log('githubPlugin - requestSaveRemotePublishedElements', opts);

    // const defer = Q.defer()
    var meta = opts.rootState.application.config.meta;
    var repository = githubInstance.getRepo(meta.username, meta.repositoryName);

    var promises = [];
    var totalElementsToPublish = opts.nextState.elementsToPublish.length;
    var chunkOfElements = _lodash2.default.chunk(opts.nextState.elementsToPublish, TREE_CHUNK_SIZE);

    console.log('Writeall', opts.nextState.elementsToPublish);

    var rootPromise = _q2.default.defer();

    repository.getBranch(meta.branch, function (err, branch) {
      if (err) {
        var deferred = _q2.default.defer();
        rootPromise = deferred.promise;
        return deferred.reject(err);
      }
      var publishedCount = 0;
      var chainPromise = chunkOfElements.reduce(function (promise, elements) {

        var callback = function callback(branchLatestCommit) {
          var deferred = _q2.default.defer();
          var tree = elements.map(function (element) {
            return {
              path: element.path,
              mode: '100644',
              type: 'blob',
              content: element.content
            };
          });
          repository.createTree(tree, branchLatestCommit, function (err, branch) {
            if (err) {
              return deferred.reject(err);
            }

            repository.commit(branchLatestCommit, branch.sha, 'Published ' + (publishedCount + elements.length) + '/' + totalElementsToPublish + ' elements', function (err, commit) {
              if (err) {
                return deferred.reject(err);
              }
              publishedCount = publishedCount + elements.length;
              repository.updateHead('heads/' + meta.branch, commit.sha, false, function (err, res) {
                console.log('updateHead', err, res);
                if (err) {
                  return deferred.reject(err);
                }
                deferred.resolve(commit.sha);
              });
            });
          });

          return deferred.promise;
        };

        return promise.then(callback);
      }, (0, _q2.default)(branch.commit.sha));

      chainPromise.then(function (sha) {
        rootPromise.resolve(opts);
      }).catch(function (err) {
        rootPromise.reject(err);
      });
    });
    return rootPromise.promise;
  });

  context.on('requestDeleteRemotePost', function (opts) {
    console.info('githubPlugin - requestDeleteRemotePost');
    console.log('githubPlugin - requestDeleteRemotePost', opts);
    var defer = _q2.default.defer();
    var config = opts.rootState.application.config;
    var meta = config.meta;
    var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
    var elementPath = opts.nextState.post.original.path;

    repository.deleteFile(meta.branch, elementPath, function (err, sha) {
      if (err && err.response && err.response.status !== 404) {
        defer.reject(err);
      } else {
        defer.resolve(opts);
      }
    }).catch(function (err) {
      if (err && err.response && err.response.status === 404) {
        defer.resolve(opts);
      }
    });

    return defer.promise;
  });

  context.on('requestDeleteRemotePublishedPost', function (opts) {
    console.info('githubPlugin - requestDeleteRemotePublishedPost');
    console.log('githubPlugin - requestDeleteRemotePublishedPost', opts);
    var defer = _q2.default.defer();
    var config = opts.rootState.application.config;
    var meta = config.meta;
    var repository = githubInstance.getRepo(meta.username, meta.repositoryName);
    var elementPath = config.urls.getPostGhPath(opts.nextState.post.original.name);

    repository.deleteFile(meta.branch, elementPath, function (err, sha) {
      if (err) {
        defer.reject(err);
      } else {
        defer.resolve(opts);
      }
    });

    return defer.promise;
  });

  context.on('application:request-save-config', function (opts) {
    console.info('githubPlugin - application:request-save-config');
    console.log('githubPlugin - application:request-save-config', opts);

    var application = opts.nextState.application;
    return writeConfig(application.config).then(function (sha) {
      return manageCname(application.config);
    }).then(function (sha) {
      return opts;
    });
  });

  context.on('receiveRenderingPost', function (opts) {
    console.info('githubPlugin - receiveRenderingPost');
    console.log('githubPlugin - receiveRenderingPost', opts);
    return opts;
  });

  context.on('application:initialize-plugins', function (opts) {
    console.info('githubPlugin - application:initialize-plugins');
    console.log('githubPlugin - application:initialize-plugins', opts);

    // Check if the config.json is ok
    var requireInitilisation = opts.rootState.application.config.meta.repositoryName === 'put your repository name here' || opts.rootState.application.config.meta.username === 'put your username here';

    opts.nextState.application.requireInitilisation = requireInitilisation;
    opts.nextState.application.config.initialisationConfigComponent = _InitConfig2.default;

    return opts;
  });
}