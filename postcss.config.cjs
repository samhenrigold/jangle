module.exports = {
  plugins: [
    require('autoprefixer'),
    require('cssnano')({
      preset: ['default', {
        // inset:0 (Safari 14.1+) must never replace top/right/bottom/left
        // on a site targeting iOS 4-6 Safari.
        mergeLonghand: false,
      }],
    }),
  ],
};
