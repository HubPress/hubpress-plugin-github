import platform from 'platform';
import fetch from 'isomorphic-fetch';
import slugify from 'hubpress-core-slugify';
import Github from 'github-api';
import Q from 'q';
import _ from 'lodash';

function getRepositoryInfos(repository) {
  let deferred = Q.defer();

  repository.show(function(err, informations) {
    if (err) {
      deferred.reject(err);
    }
    else {
      deferred.resolve(informations);
    }
  });

  return deferred.promise;
}

function getAuthorizations(authorization) {
  let deferred = Q.defer();

  authorization.list(function(err, list) {
    if (err) {
      deferred.reject(err);
    }
    else {
      deferred.resolve(list);
    }
  });

  return deferred.promise;


}

function getUserInformations(user) {

  return function(username) {
    let deferred = Q.defer();

    user.show(username, function(err, informations) {
      if (err) {
        deferred.reject(err);
      }
      else {
        deferred.resolve(_.pick(informations, [
          'login',
          'id',
          'name',
          'location',
          'blog',
          'avatar_url',
          'bio'
        ]));
      }
    });

    return deferred.promise;

  }
}

function getTokenNote() {
  //return S(`hubpress-${platform.name}-${platform.os}`).slugify().s;
  return slugify(`hubpress-${platform.name}-${platform.os}`);
}

function _searchAndDeleteAuthorization(authorizations, authorization ) {
  let deferred = Q.defer();
  let id = -1;
  const TOKEN_NOTE = getTokenNote();
  authorizations.forEach(function(token) {
    let note = token.note;
    if (note === TOKEN_NOTE) {
      id = token.id;
    }
  });

  if (id !== -1) {
    authorization.delete(id, function(err, values) {
      if (err) {
        deferred.reject(err);
      }
      else {
        deferred.resolve();
      }
    });
  }
  else {
    deferred.resolve();
  }


  return deferred.promise;
}

function _createAuthorization(authorization) {
  let deferred = Q.defer();
  let definition = {
    scopes: [
    'public_repo'
    ],
    note: getTokenNote()
  };


  authorization.create(definition, function(err, createdToken) {
    if (err) {
      deferred.reject(err);
    }
    else {
      deferred.resolve(createdToken);
    }
  });

  return deferred.promise;
}

let githubInstance;

function login (opts) {
  console.log('Github Plugin - login', opts);
  const deferred = Q.defer();
  const credentials = opts.data.authentication.credentials;
  const meta = opts.state.application.config.meta;

  githubInstance = new Github({
    auth: "basic",
    username: credentials.email,
    password: credentials.password,
    twoFactorCode: credentials.twoFactorCode
  });

  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  const authorization = githubInstance.getAuthorization();
  const user = githubInstance.getUser();
  let _informations;
  let _userInformations;


  getRepositoryInfos(repository)
    .then(function(informations) {
      _informations = informations;
    })
    .then(getUserInformations(user))
    .then(function(userInformations) {
      _userInformations = userInformations;
      return getAuthorizations(authorization);
    })
    .then(function(authorizations) {
      return _searchAndDeleteAuthorization(authorizations, authorization);
    })
    .then(function() {
      return _createAuthorization(authorization);
    })
    .then(function(result) {
      githubInstance = new Github({
        auth: "oauth",
        token: result.token
      });

      deferred.resolve({
        isAuthenticated: true,
        token: result.token,
        permissions: _informations.permissions,
        userInformations: _userInformations
      });
    })
    .catch(function(error) {
      console.error('Github Plugin - login error', error);
      var message = {
        type: 'error',
        title: 'Authentication'
      }
      var otpRequired;

      if (error.request) {
        var otp = error.request.getResponseHeader('X-GitHub-OTP') || '';
        otpRequired = otp.split(';')[0] === 'required';
      }

      if (otpRequired) {
        // force sms with a post on auth
        _createAuthorization(authorization);

        console.log('Github Plugin - OTP required : ', otpRequired);
        message.type = 'warning';
        message.content = 'A two-factor authentication code is needed.';
        message.otp = true;

        deferred.resolve({
          isAuthenticated: false,
          twoFactorRequired: true
        })
      }
      else {
        console.error('Github Plugin - login error', error);

        deferred.reject({
          error: {
            code: error.error,
            message: 'Unable to authenticate, check your credentials.'
          }
        })
      }
    });

    return deferred.promise;
}

function getGithubPostsSha(repository, config) {

  let deferred = Q.defer();

  repository.read(config.meta.branch, '', (err, elements) => {
    if (err) {
      deferred.reject(err);
    }
    else {
      let postsSha;
      elements = JSON.parse(elements);

      elements.forEach((element) => {
        if (element.name === '_posts'){
          postsSha = element.sha;
        }
      });
      deferred.resolve(postsSha);
    }
  });

  return deferred.promise;

};

function getPostsGithub(repository, config, sha) {
  let promise;

  if (sha === localStorage.postsSha) {
    promise = Q.fcall(function() {
      return [];
    });
  }
  else {
    let deferred = Q.defer();
    repository.read(config.meta.branch, '_posts', (err, posts) => {
      if (err) {
        deferred.reject(err);
      }
      else {
        deferred.resolve(JSON.parse(posts));
      }
    });

    promise = deferred.promise;
  }

  return promise;
}

function markIfPostPublished (config, post) {
  const defer = Q.defer();
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  repository.getSha(config.meta.branch, config.urls.getPostGhPath(post.name), (err, sha) => {
    if (err && err.error !==404) {
      defer.reject(err);
    }
    else {
      const isPublished = !!sha ? 1 : 0;
      const _post = Object.assign({}, post, {published: isPublished});
      console.log("markIfPostPublished post", _post);
      defer.resolve(_post);
    }
  });

  return defer.promise;
}

function markIfPostsPublished (repository, config, posts) {
  const _posts = _.compact(posts);

  const promises = _posts.map((post) => {
    return markIfPostPublished(config, post);
  });

  return Q.all(promises);
}

function getPostAuthor (config, post, userInformations) {
  const defer = Q.defer();
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  console.log('getPostAuthor', post);
  repository.getCommits({
    sha: config.meta.branch,
    path: post.path
  }, (err, commits) => {
    if (err && err.error !==404) {
      defer.reject(err);
    }
    else {
      let author = commits[0].author;
      if (author.login === userInformations) {
        author = Object.assign({}, userInformations);
        const _post = Object.assign({}, post, {author});
        defer.resolve(_post);
      }
      else {
        const user = githubInstance.getUser();
        getUserInformations(user)(author.login)
        .then( userInfos => {
          author = Object.assign({}, userInfos);
          const _post = Object.assign({}, post, {author});
          defer.resolve(_post);
        })
        .catch(e => defer.reject(e));
      }
    }
  });

  return defer.promise;
}

function getPostsAuthor (repository, config, posts, userInformations) {
  const promises = posts.map((post) => {
    return getPostAuthor(config, post, userInformations);
  });

  return Q.all(promises);
}


function readContent(repository, config, posts) {
  let promises = [];

  posts.forEach((post) => {
    let deferred = Q.defer();
    promises.push(deferred.promise);

    repository.read(config.meta.branch, post.path, (err, content) => {
      if (err) {
        deferred.reject(err);
      }
      else {
        let _post;
          _post = Object.assign({}, post, {
            content: content
          });

        deferred.resolve(_post);
      }
    });
  });

  return Q.all(promises);

}

function getPosts (data) {
  const config = data.config;
  console.log('Get posts', config);
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  return getGithubPostsSha(repository, config)
  .then((sha) => {
    return getPostsGithub(repository, config,sha);
  })
  .then(posts => {
    return posts.map(post => _.pick(post, ['name', 'path', 'sha', 'size']))
  })
  .then((posts)=>{
    return markIfPostsPublished(repository, config, posts);
  })
  .then((posts)=>{
    return getPostsAuthor(repository, config, posts, data.authentication.credentials.userInformations);
  })
  .then((posts)=>{
    return readContent(repository, config, posts);
  })
}

function deleteElement (repository, branch, elementPath) {
  const defer = Q.defer();
  repository.delete(branch, elementPath, (err, sha) => {
    if (err) {
      defer.reject(err);
    }
    else {
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
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);

  let returnedPromise;

  // Check if the name has  changed
  if (post.original && post.name !== post.original.name) {
    const defer = Q.defer();
    returnedPromise = defer.promise;

    const branch = config.meta.branch;
    const origin = `_posts/${post.original.name}`;
    const dest = `_posts/${post.name}`

    repository.move(branch, origin, dest, (err, sha) => {
      if (err) {
        defer.reject(err);
      }
      else {
        // if published, then removed
        if (!post.published) {
          defer.resolve({post: post, sha: sha});
        }
        else {
          // Remove the post published with the old name
          let oldPublishedPostPath = config.urls.getPostGhPath(post.original.name);

          deletePost(repository, branch, oldPublishedPostPath)
          .then(sha => {
            defer.resolve({post: post, sha: sha});
          })
          .catch(err => {
            defer.reject(err);
          })
          .done();
        }
      }
    });
  }
  else {
    returnedPromise = Q({post: post});
  }

  return returnedPromise;
}

function writePost(config, post) {
  console.log('Write post', config, post);
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  const branch = meta.branch;
  const postPath = `_posts/${post.name}`;
  const commitMessage = `Update ${post.name}`;
	const defer = Q.defer();
	repository.write(branch, postPath, post.content, commitMessage, (err, sha) => {
		if (err) {
			defer.reject(err);
		}
		else {
			post.original = _.omit(post, ['original']);//Object.assign({}, post);
			post.original.url = config.urls.getPostUrl(post.original.name);
			post.original.path = '_posts/' + post.original.name;
			post.original.sha = sha;
			defer.resolve(post);
		}

	})

	return defer.promise;
}

function writeConfig (config) {
  console.log('Write config', config);
  const defer = Q.defer();
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  const branch = meta.branch;

  repository.write(branch, 'hubpress/config.json', JSON.stringify(config, null, 2), 'Update configuration file', (err, sha) => {
    if (err) {
      defer.reject(err);
    }
    else {
      defer.resolve(sha);
    }
  });
  return defer.promise;
}

function manageCname (config) {
  console.log('Github manageCname - ', config);
  const meta = config.meta;
  const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
  const defer = Q.defer();
  const cb = (err, sha) => {
    // not found if we try to delete CNAME that not exist
    // TODO Compare with the previous settings state
    if (err && err !== 'not found') {
      defer.reject(err);
    }
    else {
      defer.resolve(sha);
    }
  }

  if (!meta.cname || meta.cname === '') {
    console.info('SettingsService - saveAndPublish delete CNAME');
    repository.delete(meta.branch, 'CNAME', cb);
  } else {
    console.info('SettingsService - saveAndPublish save CNAME');
    repository.write(meta.branch, 'CNAME', meta.cname, `Update CNAME with ${meta.cname}`, cb);
  }

  return defer.promise;
}


export function githubPlugin (hubpress) {

  hubpress.on('requestConfig', (opts) => {
    console.info('Github Plugin - requestConfig');
    console.log('requestConfig', opts);
    return fetch('config.json?dt='+Date.now())
      .then(req => req.json())
      .then(config => {
        const mergeConfig = Object.assign({}, config, opts.data.config);
        // TODO remove after 0.6.0
        mergeConfig.theme.name = mergeConfig.theme.name.toLowerCase();
        const data = Object.assign({}, opts.data, {config: mergeConfig});
        return Object.assign({}, opts, {data});
      });
  });

  hubpress.on('requestAuthentication', (opts) => {
    console.info('Github Plugin - requestAuthentication');
    console.log('requestAuthentication', opts);
    return login(opts)
    .then((result) => {
      const mergeAuthentication = Object.assign({}, result, opts.data.authentication);
      const data = Object.assign({}, opts.data, {authentication: mergeAuthentication});
      return Object.assign({}, opts, {data});
    });
  });

  hubpress.on('receiveSavedAuth', (opts) => {
    console.info('Github Plugin - receiveSavedAuth');
    console.log('receiveSavedAuth', opts);
    if (opts.data.authentication.isAuthenticated) {
      githubInstance = new Github({
        auth: "oauth",
        token: opts.data.authentication.credentials.token
      });
    }
    return opts;
  });

  hubpress.on('requestRemoteSynchronization', (opts) => {
    console.info('Github Plugin - requestRemoteSynchronization');
    console.log('requestRemoteSynchronization', opts);
    if (!opts.data.authentication.isAuthenticated) {
      return opts;
    }
    return getPosts(opts.data)
      .then(posts => {
        // TODO Check if order is good here
        const mergeDocuments = Object.assign({}, {posts}, opts.data.documents);
        const data = Object.assign({}, opts.data, {documents: mergeDocuments});
        return Object.assign({}, opts, {data});
      });

  });

  hubpress.on('requestSaveRemotePost', (opts) => {
    console.info('Github Plugin - requestSaveRemotePost');
    console.log('requestSaveRemotePost', opts);
    const config = opts.state.application.config;
    const post = opts.data.post;
    // Move if necessary
    return movePostIfNecessary(config, post)
    .then(result =>{
      return getPostAuthor(config, post, opts.state.authentication.credentials.userInformations);
    })
    .then(_post => {
      return writePost(config, _post);
    })
    .then(updatedPost => {
      const data = Object.assign({}, opts.data, {post: updatedPost});
      return Object.assign({}, opts, {data});
    });
  });

  hubpress.on('requestSaveRemotePublishedElements', (opts) => {
    console.info('Github Plugin - requestSaveRemotePublishedElements');
    console.log('requestSaveRemotePublishedElements', opts);

    const defer = Q.defer();
    const meta = opts.state.application.config.meta;
    const repository = githubInstance.getRepo(meta.username, meta.repositoryName);

    repository.writeAll(meta.branch, opts.data.elementsToPublish, (err, commit) => {
      if (err) {
        defer.reject(err);
      }
      else {
        repository.write(meta.branch, '.last-sha', commit, 'Update last sha', (err, sha) => {
          if (err) {
            console.log('.last-sha', err);
            defer.reject(err);
          }
          else {
            console.log('.last-sha done');
            defer.resolve(opts);
          }
        });
      }
    });

    return defer.promise;
  });

  hubpress.on('requestDeleteRemotePost', (opts) => {
    console.info('Github Plugin - requestDeleteRemotePost');
    console.log('requestDeleteRemotePost', opts);
    const defer = Q.defer();
    const config = opts.state.application.config;
    const meta = config.meta;
    const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
    const elementPath = opts.data.post.original.path;


    repository.delete(meta.branch, elementPath, (err, sha)=>{
      if (err) {
        defer.reject(err);
      }
      else {
        defer.resolve(opts);
      }
    });

    return defer.promise;
  });

  hubpress.on('requestDeleteRemotePublishedPost', (opts) => {
    console.info('Github Plugin - requestDeleteRemotePublishedPost');
    console.log('requestDeleteRemotePublishedPost', opts);
    const defer = Q.defer();
    const config = opts.state.application.config;
    const meta = config.meta;
    const repository = githubInstance.getRepo(meta.username, meta.repositoryName);
    const elementPath = config.urls.getPostGhPath(opts.data.post.original.name);


    repository.delete(meta.branch, elementPath, (err, sha)=>{
      if (err) {
        defer.reject(err);
      }
      else {
        defer.resolve(opts);
      }
    });

    return defer.promise;
  });

  hubpress.on('requestSaveConfig', (opts) => {
    console.info('Github Plugin - requestSaveConfig');
    console.log('requestSaveConfig', opts);

    return writeConfig(opts.data.config)
      .then(sha => manageCname(opts.data.config))
      .then(sha => {
        console.error('mouahahaha',opts);
        return opts
      });

  });
}