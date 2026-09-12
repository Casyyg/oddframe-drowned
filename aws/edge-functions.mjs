// CloudFront Functions source: keep these handlers self-contained.
/* eslint-disable no-var -- Keep serialized edge handlers compatible with the restricted edge runtime. */
export function pageHandler(event) {
  var request = event.request;
  var routes = {'/':'/index.html','/drowned':'/drowned.html','/drowned/':'/drowned.html','/insights':'/insights.html','/insights/':'/insights.html'};
  if (/^\/(play|stats)(\/|$)/.test(request.uri)) {
    return {statusCode:404,statusDescription:'Not Found',headers:{'cache-control':{value:'no-store'}}};
  }
  if (routes[request.uri]) request.uri = routes[request.uri];
  return request;
}

export function mediaHandler(event) {
  var request = event.request;
  if (!/^\/api\/media\/drowned\/[a-zA-Z0-9_-]+\.mp4$/.test(request.uri)) {
    return {statusCode:404,statusDescription:'Not Found',headers:{'cache-control':{value:'no-store'}}};
  }
  request.uri = request.uri.slice(4);
  return request;
}

export const cloudFrontSource = fn => fn.toString().replace(/^function \w+\(/, 'function handler(');
