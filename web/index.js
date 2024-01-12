import * as $ from 'jquery';
import i18n from 'i18next';
import { DataHarmonizer, Footer, Toolbar } from '@/lib';
import { initI18n } from '@/lib/utils/i18n';
import { Template } from '@/lib/utils/templates';

import menu from '@/web/templates/menu.json';
import tags from 'language-tags';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@/web/index.css';

const rootUrl = window.location.host;
console.log('Root URL:', rootUrl);

async function getTemplatePath() {
  let templatePath;
  if (window.URLSearchParams) {
    let params = new URLSearchParams(location.search);
    templatePath = params.get('template');
  } else {
    templatePath = location.search.split('template=')[1];
  }
  if (templatePath === null || typeof templatePath === 'undefined') {
    const menu = (await import(`@/web/templates/menu.json`)).default;
    const schema_name = Object.keys(menu)[0];
    const template_name = Object.keys(menu[schema_name])[0];
    return `${schema_name}/${template_name}`;
  }
  return templatePath;
}

class AppConfig {
  constructor(template_path=null) {
    this.rootUrl = window.location.host;
    this.template_path = template_path;
  }
}

class AppContext {

  constructor(appConfig) {
    this.template = null;
    this.appConfig = appConfig;
  }

  async initializeTemplate(template_path) {
    console.log(template_path);
    const [schema_name, template_name] = template_path.split('/');
    if (!this.template) {
      this.template = await Template.create(schema_name);
    }
    return this;
  }
  
  async getSchema() {
    return this.template.current.schema;
  }

  async getLocaleData(template) {
    const locales = {
      default: { langcode: 'default', nativeName: 'Default' },
    };
  
    this.template.locales.forEach((locale) => {
      const langcode = locale.split('-')[0];
      const nativeName = tags.language(langcode).data.record.Description[0] || 'Default';
      locales[langcode] = { langcode, nativeName };
    });
  
    return locales;
  }

  async addTranslationResources(template, locales = null) {
    if (locales === null) {
      locales = this.getLocaleData(template);
    }
    // Consolidate function for reducing objects
    function consolidate(iterable, reducer) {
      return Object.entries(iterable).reduce(reducer, {});
    }

    const defaultLocale = {
      langcode: 'default',
      nativeName: 'Default',
    };
    locales = {
      default: defaultLocale,
    };

    template.locales.forEach((locale) => {
      
      const langcode = locale.split('-')[0];
      const nativeName =
        tags.language(langcode).data.record.Description[0] || 'Default';
      locales[langcode] = { langcode, nativeName };

    });

    Object.entries(template.translations).forEach(
      ([langcode, translation]) => {
        const schema_resource = consolidate(
          translation.schema.slots,
          (acc, [slot_symbol, { name }]) => ({
            ...acc,
            [slot_symbol.replace(/ /g, '_')]: name,
          })
        );

        const enum_resource = consolidate(
          translation.schema.enums,
          (acc, [enum_symbol, { permissible_values }]) => {
            for (const [enum_value, { text }] of Object.entries(
              permissible_values
            )) {
              acc[enum_value] = text;
            }
            return acc;
          }
        );

        const translated_sections = consolidate(
          translation.schema.classes[template.default.schema.name].slot_usage,
          (acc, [translation_slot_name, { slot_group }]) => ({
            ...acc,
            [translation_slot_name]: slot_group,
          })
        );

        const default_sections = consolidate(
          template.default.schema.classes[template.default.schema.name]
            .slot_usage,
          (acc, [default_slot_name, { slot_group }]) => ({
            ...acc,
            [default_slot_name]: slot_group,
          })
        );

        const section_resource = consolidate(
          translated_sections,
          (acc, [translation_slot_name]) => ({
            ...acc,
            [default_sections[translation_slot_name]]:
              translated_sections[translation_slot_name],
          })
        );

        i18n.addResources(langcode.split('-')[0], 'translation', {
          ...section_resource,
          ...schema_resource,
          ...enum_resource,
        });
      }
    );
  }

  async  getSlotGroups() {
    const schema = this.template.current.schema;
    const slotGroups = new Set();

    if (schema.classes) {
        for (const className in schema.classes) {
            const classInfo = schema.classes[className];
            if (classInfo.slot_usage) {
                for (const slotName in classInfo.slot_usage) {
                    const slotInfo = classInfo.slot_usage[slotName];
                    if (slotInfo.slot_group) {
                        slotGroups.add(slotInfo.slot_group);
                    }
                }
            }
        }
    }

    return Array.from(slotGroups);
  }

  async getLocales() {
    const locales = this.getLocaleData(this.template);
    this.addTranslationResources(this.template, locales); // TODO side effect – put elsewhere?
    return locales;
  }

  async getExportFormats(schema) {
    return (await import(`@/web/templates/${schema}/export.js`)).default;
  }
}

// Make the top function asynchronous to allow for a data-loading/IO step?
const main = async function () {

  const context = new AppContext(new AppConfig(await getTemplatePath()));
  let dhs = [];
  context.initializeTemplate(context.appConfig.template_path)
    .then(async (context) => {
      const _template = context.template;

      const dhRoot = document.querySelector('#data-harmonizer-grid');
      const dhFooterRoot = document.querySelector('#data-harmonizer-footer');
      const dhToolbarRoot = document.querySelector('#data-harmonizer-toolbar');
    
      const sections = await context.getSlotGroups();
      console.log(sections);

      // for each section: 
      // 0) create a new holding element for the data harmonizer
      // 1) add the holding element to the data-harmonizer-grid
      // 2) create a new data harmonizer instance
      // 3) add the data harmonizer instance to the application list with the holding element as argument
      // this loading process needs to occur on each change of the application?
      if (sections.length > 0) {
        // NOTE: TODO: per section? or with multiple?
        // TODO: place in tabs?
        sections.forEach((section, index) => {
          const dhSubroot = $(`<div id="data-harmonizer-grid-${index}" class="data-harmonizer-grid"></div>`);  // TODO: element type, use rows and cols?
          $(dhRoot).append(dhSubroot); // TODO: location?
          const dh = new DataHarmonizer(dhSubroot, {
            // loadingScreenRoot: document.querySelector('body'),
            field_filters: [section]
          });
          dhs.push(dh);
        })  
      } else {
        // TODO: place in tabs?
        const index = 0;
        const dhSubroot1 = 
          $(`<div id="data-harmonizer-grid-${index}" class="data-harmonizer-grid"></div>`);  // TODO: element type, use rows and cols?
        $(dhRoot).append(dhSubroot1); // TODO: location?
        // const dhSubroot2 = 
        //   $(`<div class="col"><div id="data-harmonizer-grid-${index + 1}" class="data-harmonizer-grid"></div></div>`);  // TODO: element type, use rows and cols?
        // $(dhRoot).append(dhSubroot2); // TODO: location?
        dhs = [
          new DataHarmonizer(dhSubroot1, {
            loadingScreenRoot: document.querySelector('body')
          }),
          new DataHarmonizer(dhSubroot2, {
            loadingScreenRoot: document.querySelector('body')
          })
        ];
      }

      // // internationalize
      // // TODO: connect to locale of browser!
      // // Takes `lang` as argument (unused)
      initI18n((lang) => {
        console.log(lang);
        $(document).localize();
        dhs.forEach(dh => dh.render());
      });
      context.addTranslationResources(_template, context.getLocaleData());
    
      new Footer(dhFooterRoot, dhs[0]);

      // TODO: data harmonizers require initialization code inside of the toolbar to fully render? wut
      new Toolbar(dhToolbarRoot, dhs[0], menu, {
        templatePath: context.appConfig.template_path,  // TODO: a default should be loaded before Toolbar is constructed! then take out all loading in "toolbar" to an outside context
        releasesURL: 'https://github.com/cidgoh/pathogen-genomics-package/releases',
        getLanguages: context.getLocaleData.bind(context),
        getSchema: async (schema) => Template.create(schema).then(result => result.current.schema),
        getExportFormats: context.getExportFormats.bind(context),
      });

      // TODO: data harmonizers require initialization code inside of the toolbar to fully render? wut
      new Toolbar(dhToolbarRoot, dhs[1], menu, {
        templatePath: context.appConfig.template_path,  // TODO: a default should be loaded before Toolbar is constructed! then take out all loading in "toolbar" to an outside context
        releasesURL: 'https://github.com/cidgoh/pathogen-genomics-package/releases',
        getLanguages: context.getLocaleData.bind(context),
        getSchema: async (schema) => Template.create(schema).then(result => result.current.schema),
        getExportFormats: context.getExportFormats.bind(context),
      });

      return context;
    
    })
    .then(async () => {
      return setTimeout(() => dhs[0].showColumnsBySectionTitle(dhs[0].field_filters[0]), 1000);
    });
    
}

document.addEventListener('DOMContentLoaded', main);
