// Wraps app/index.html (written for the Artifact host, which supplies the document
// skeleton) in a full HTML document for standalone hosting.
export function wrapPage(body) {
  return '<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    + 'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
    + '</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}
