const SerialPort = require('serialport');
const EventEmitter = require('events');
const { MutableBuffer } = require('mutable-buffer');
const iconv = require('iconv-lite');

function encoding(text, encode){
  if (!encode) return text;
  return iconv.encode(text, encode);
};

function Print(deviceInfo, options){

  EventEmitter.call(this);

  this.path = deviceInfo.path;

  this.device = new SerialPort(this.path, {
    baudRate: deviceInfo.baudRate || 9200,
    autoOpen: deviceInfo.autoOpen || false
  });

  this.width = options && +options.width || 42;

  this.buffer = new MutableBuffer();

  this.encoding = '';

  this.data = [];

  this._size = [ 0, 0 ];

}

Print.Chars = {
  EOL: '\n',
  CUT: '\x1d\x56\x00',
  ALIGN: {
    CT: '\x1b\x61\x01',
    LT: '\x1b\x61\x00',
    RT: '\x1b\x61\x02'
  },
  FONT: {
    A: '\x1b\x4d\x00',
    B: '\x1b\x4d\x01',
    C: '\x1b\x4d\x02'
  },
  LINESPACE: {
    DEFAULT: '\x1b\x32',
    SET: '\x1b\x33'
  }
};

Print.prototype.encode = function(encode){
  this.encoding = encode;
  return this;
}

Print.prototype.getWidth = function(){
  return this.width / (this._size[0] + 1);
};

Print.prototype.size = function(width, height){
  width = +width;
  height = +height;

  width = width < 0 ? 0 : width;
  height = height < 0 ? 0 : height;

  width = width > 7 ? 7 : width;
  height = height > 7 ? 7 : height;

  this._size = [ width, height ];

  //return this.text('\x1d\x21' + String.fromCharCode(width * 16 + height));

  value = width * 16 + height;
  value = value.toString(16);

  value.length % 2 === 0 || (value = '0' + value);
  return this.text(Buffer.from('1d21' + value, 'hex'));
};

Print.prototype.lineSpace = function(n){
  if (n === undefined || n === null) {
    this.buffer.write(Print.Chars.LINESPACE.DEFAULT);
  } else {
    this.buffer.write(Print.Chars.LINESPACE.SET);
    this.buffer.writeUInt8(n);
  }
  return this;
};

Print.prototype.newLine = function(){
  this.buffer.write(Print.Chars.EOL);
  return this;
};

Print.prototype.text = function(text, encode){
  this.buffer.write(encoding(text, encode || this.encoding));
  return this;
};

Print.prototype.textLn = function(text, encode){
  return this.text(text, encode).newLine();
};

Print.prototype.dashedLine = function(){
  return this.textLn('-'.repeat(this.getWidth()));
};

Print.prototype.dottedLine = function(){
  return this.textLn('.'.repeat(this.getWidth()));
};

Print.prototype._formatCell = function(text, width, align){
  let emptyLength = width - text.length;
  if (!emptyLength) return text;

  if (align == 'RIGHT'){
    text = ' '.repeat(emptyLength) + text;
  }
  else if (align == 'CENTER'){
    let leftEmpty = parseInt(emptyLength / 2);
    let rightEmpty = emptyLength - leftEmpty;
    text = ' '.repeat(leftEmpty) + text + ' '.repeat(rightEmpty);
  }
  else{
    text += ' '.repeat(emptyLength);
  }

  return text;
};

Print.prototype.tableRow = function(data, options){
  if (!Array.isArray(data) || !data.length) return this;
  let { encoding: encode } = options || {}, numHasSize = 0, totalSize = 0;

  data = data.map(row => {
    let text = 'text' in row ? row.text.toString() : '', width = -1
    , align = [ 'RIGHT', 'CENTER' ].indexOf(row.align) > -1 ? row.align : 'LEFT';

    if (row && row.width && +row.width > 0){
      ++numHasSize;
      width = parseInt(this.getWidth() * row.width);
      totalSize += width;
    }

    return { text, width, align };
  });

  let remainNumSize = data.length - numHasSize
  , sizeRemainCell = parseInt((this.getWidth() - totalSize) / remainNumSize)
  , maxLine = 1;

  data = data.map(row => {
    row.width <= 0 && (row.width = sizeRemainCell);

    if (row.width <= 0){
      row.line = [''];
      return row;
    }

    let line = [], textLine = row.width > 0 ? row.text : '';

    if (textLine.length){
      let arrWord = textLine.split(' '), subText = [], word, added = false;

      do{
        word = arrWord.shift();
        let currentLength = subText.join(' ').length;
        
        if (word.length + currentLength + 1 < row.width){
          subText.push(word);
          added = false;
        }
        else if (word.length > row.width){
          currentLength > 0 && line.push(subText.join(' '));
          subText = [];
          let isBreak;

          do{
            line.push(word.substr(0, row.width));
            word = word.substr(row.width);
            isBreak = (word.length < row.width);
            isBreak && subText.push(word);
          }
          while(!isBreak);

          added = !subText.length;
        }
        else{
          line.push(this._formatCell(subText.join(' '), row.width, row.align));
          added = true;
          subText = [];
        }
      }
      while(arrWord.length);

      if (!added){
        subText = subText.join(' ');
        subText.length && line.push(this._formatCell(subText, row.width, row.align));
      }
    }
    else{
      line.push(' '.repeat(textLine.length));
    }

    line.length > maxLine && (maxLine = line.length);
    row.line = line;

    return row;
  });

  let lineTxt, i = 0;

  for (i = 0; i < maxLine; ++i){
    lineTxt = '';
    
    data.map(row => {
      let length = row.line[i] ? row.line[i].length : 0;
      lineTxt += (row.line[i] || '') + ' '.repeat(row.width - length);
    });

    this.textLn(lineTxt, encode);
  }

  return this;
};

Print.prototype.align = function(align){
  this.buffer.write(Print.Chars.ALIGN[align.toUpperCase()]);
  return this;
};

Print.prototype.font = function(type){
  this.buffer.write(Print.Chars.FONT[type.toUpperCase()]);
  return this;
};

Print.prototype.feed = function(n){
  this.buffer.write(new Array(+n || 1).fill(Print.Chars.EOL).join(''));
  return this;
}

Print.prototype.cut = function(feed){
  this.feed(+feed || 3).buffer.write(Print.Chars.CUT);
  this.data.push({ text: Print.Chars.CUT });
  return this;
};

Print.prototype.open = function(callback){
  this.device.open(err => typeof callback === 'function' && callback.call(this, err));
  return this;
}

Print.prototype.flush = function(callback){
  var buf = this.buffer.flush();
  this.device.write(buf, callback);
  return this;
};

Print.prototype.close = function(callback, options){
  return this.flush(() => this.device.close(callback, options));
};

module.exports = Print;