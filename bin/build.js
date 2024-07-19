/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable prefer-template */
const path = require('path');
const fs = require('fs');
const format = require('prettier-eslint');
const processSvg = require('./processSvg');
const { parseName } = require('./utils');
const defaultStyle = process.env.npm_package_config_style || 'stroke';
const { getAttrs, getElementCode } = require('./template');
const icons = require('../src/data.json');
const rootDir = path.join(__dirname, '..');
// where icons code in
const srcDir = path.join(rootDir, 'src');
const iconsDir = path.join(rootDir, 'src/icons');

// generate icons.js and icons.d.ts file
const generateIconsIndex = () => {
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir);
    fs.mkdirSync(iconsDir);
  } else if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir);
  }
  const initialTypeDefinitions = `/// <reference types="react" />
import { ComponentType, SVGAttributes } from 'react';
interface Props extends SVGAttributes<SVGElement> {
  color?: string;
  size?: string | number;
}
type Icon = ComponentType<Props>;
`;
  fs.writeFileSync(path.join(rootDir, 'src', 'icons.js'), '', 'utf-8');
  fs.writeFileSync(
    path.join(rootDir, 'src', 'icons.d.ts'),
    initialTypeDefinitions,
    'utf-8',
  );
};

// generate attributes code
const attrsToString = (attrs, style) => {
  console.log('style: ', style);
  return Object.keys(attrs).map((key) => {
    // should distinguish fill or stroke
    if (key === 'width' || key === 'height' || key === style) {
      return key + '={' + attrs[key] + '}';
    }
    if (key === 'otherProps') {
      return '{...otherProps}';
    }
    return key + '="' + attrs[key] + '"';
  }).join(' ');
};

// generate icon code separately
const generateIconCode = async ({ name }) => {
  const names = parseName(name, defaultStyle);
  console.log(names);
  const fileName = names.name.replace(/[^a-zA-Z0-9]/g, ''); // Remove non-alphanumeric characters
  const location = path.join(rootDir, 'src/svg', `${fileName}.svg`);
  const destination = path.join(rootDir, 'src/icons', `${fileName}.js`);
  
  try {
    if (!fs.existsSync(location)) {
      console.error(`SVG file not found: ${location}`);
      return null;
    }
    
    const code = fs.readFileSync(location, 'utf8');
    const svgCode = await processSvg(code);
    const ComponentName = names.componentName;
    const element = getElementCode(ComponentName, attrsToString(getAttrs(names.style), names.style), svgCode);
    const component = format({
      text: element,
      eslintConfig: {
        extends: 'airbnb',
      },
      prettierOptions: {
        bracketSpacing: true,
        singleQuote: true,
        parser: 'flow',
      },
    });
    fs.writeFileSync(destination, component, 'utf-8');
    console.log('Successfully built', ComponentName);
    return { ComponentName, name: fileName };
  } catch (error) {
    console.error(`Error generating code for icon: ${name}`, error);
    return null;
  }
};

// append export code to icons.js
const appendToIconsIndex = ({ ComponentName, name }) => {
  const exportString = `export { default as ${ComponentName} } from './icons/${name}';\r\n`;
  fs.appendFileSync(
    path.join(rootDir, 'src', 'icons.js'),
    exportString,
    'utf-8',
  );
  const exportTypeString = `export const ${ComponentName}: Icon;\n`;
  fs.appendFileSync(
    path.join(rootDir, 'src', 'icons.d.ts'),
    exportTypeString,
    'utf-8',
  );
};

generateIconsIndex();

Promise.all(
  Object
    .keys(icons)
    .map(key => icons[key])
    .map(({ name }) => generateIconCode({ name }))
)
  .then(results => {
    results.filter(Boolean).forEach(result => {
      if (result) {
        appendToIconsIndex(result);
      }
    });
    console.log('Icon generation completed.');
  })
  .catch(error => {
    console.error('Error during icon generation:', error);
  });
