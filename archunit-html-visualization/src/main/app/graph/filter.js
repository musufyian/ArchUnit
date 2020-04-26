'use strict';

const sortTopological = require('./infrastructure/graph-algorithms').sortTopological;

const matchAll = () => true;

const FilterPrecondition = class {
  constructor() {
  }

  get filterIsEnabled() {
    throw new Error('not implemented');
  }
};

const DynamicFilterPrecondition = class extends FilterPrecondition {
  constructor(getFilterIsEnabled) {
    super();
    this._getFilterIsEnabled = getFilterIsEnabled;
  }

  get filterIsEnabled() {
    return this._getFilterIsEnabled();
  }
};

const StaticFilterPrecondition = class extends FilterPrecondition {
  constructor(filterIsEnabled) {
    super();
    this._filterIsEnabled = filterIsEnabled;
  }

  set filterIsEnabled(value) {
    this._filterIsEnabled = value;
  }

  get filterIsEnabled() {
    return this._filterIsEnabled;
  }
};

const Filter = class {
  constructor(key, filterPrecondition, dependentFilterKeys) {
    this._key = key;
    this._filterGroupKey = null;
    this._filterPrecondition = filterPrecondition;
    this._dependentFilterKeys = new Set(dependentFilterKeys);
  }

  get filterPrecondition() {
    return this._filterPrecondition;
  }

  get dependentFilterKeys() {
    return this._dependentFilterKeys;
  }

  addDependentFilterKey(filterKey) {
    this._dependentFilterKeys.add(filterKey);
  }

  set filterGroupKey(value) {
    this._filterGroupKey = value;
  }

  get key() {
    return this._key;
  }

  get filterGroupKey() {
    return this._filterGroupKey;
  }

  get totalKey() {
    return this._filterGroupKey + '.' + this._key;
  }

  get filter() {
    throw new Error('not implemented');
  }
};

const StaticFilter = class extends Filter {
  constructor(key, filterPrecondition, filter, dependentFilterKeys) {
    super(key, filterPrecondition, dependentFilterKeys);
    this._filter = filter;
  }

  set filter(value) {
    this._filter = value;
  }

  get filter() {
    return this._filterPrecondition.filterIsEnabled ? this._filter : matchAll;
  }
};

const DynamicFilter = class extends Filter {
  constructor(key, filterPrecondition, getFilter, dependentFilterKeys) {
    super(key, filterPrecondition, dependentFilterKeys);
    this._getFilter = getFilter;
  }

  get filter() {
    return this._filterPrecondition.filterIsEnabled ? this._getFilter() : matchAll;
  }
};

const FilterGroup = class {
  constructor(key, filterObject) {
    this._key = key;
    this._objectToFilter = filterObject;
    this._filters = new Map();
  }

  get key() {
    return this._key;
  }

  getFilter(key) {
    return this._filters.get(key);
  }

  addFilter(filter) {
    filter.filterGroupKey = this.key;
    this._filters.set(filter.key, filter);
  }

  runFilter(key) {
    this._objectToFilter.runFilter(this._filters.get(key).filter, key);
  }

  initFilter(key) {
    this._objectToFilter.runFilter(matchAll, key);
  }

  applyFilters() {
    this._objectToFilter.applyFilters();
  }
};

const FilterCollection = class {
  constructor() {
    this._filterGroups = new Map();
  }

  _getFilterGroup(key) {
    return this._filterGroups.get(key);
  }

  getFilter(key) {
    const keys = key.split('.');
    return this._getFilterGroup(keys[0]).getFilter(keys[1]);
  }

  addFilterGroup(filterGroup) {
    this._filterGroups.set(filterGroup.key, filterGroup);
  }

  _initFilters() {
    const allFilters = [].concat.apply([], [...this._filterGroups.values()].map(group => [...group._filters.values()]));
    allFilters.forEach(f => this._getFilterGroup(f.filterGroupKey).initFilter(f.key));
  }

  finishCreation() {
    [...this._filterGroups.values()].forEach(g => [...g._filters.values()].forEach(f => f.dependentFilterKeys.forEach(d => {
      const keys = d.split('.');
      if (!this._filterGroups.has(keys[0]) || !this._getFilterGroup(keys[0])._filters.has(keys[1])) {
        throw new Error('invalid filter dependencies');
      }
    })));
    this._initFilters();
  }

  updateFilter(filterKey) {
    const topologicalOrdered = sortTopological(this.getFilter(filterKey),
      filter => [...filter.dependentFilterKeys].map(dependentFilterKey => this.getFilter(dependentFilterKey)));
    topologicalOrdered.forEach(filter => {
      this._getFilterGroup(filter.filterGroupKey).runFilter(filter.key);
    });

    [...this._filterGroups.values()].forEach(v => v.applyFilters());
  }
};

const buildFilterGroup = (key, filterObject) => {
  const filterGroup = new FilterGroup(key, filterObject);
  const filterGroupBuilder = {
    addStaticFilter: (key, filter, dependentFilterKeys = []) => {
      return {
        withDynamicFilterPrecondition: getFilterIsEnabled => {
          filterGroup.addFilter(new StaticFilter(key,
            new DynamicFilterPrecondition(getFilterIsEnabled), filter, dependentFilterKeys));
          return filterGroupBuilder;
        },

        withStaticFilterPrecondition: filterIsEnabled => {
          filterGroup.addFilter(new StaticFilter(key,
            new StaticFilterPrecondition(filterIsEnabled), filter, dependentFilterKeys));
          return filterGroupBuilder;
        }
      }
    },

    addDynamicFilter: (key, getFilter, dependentFilterKeys = []) => {
      return {
        withDynamicFilterPrecondition: getFilterIsEnabled => {
          filterGroup.addFilter(new DynamicFilter(key,
            new DynamicFilterPrecondition(getFilterIsEnabled), getFilter, dependentFilterKeys));
          return filterGroupBuilder;
        },

        withStaticFilterPrecondition: filterIsEnabled => {
          filterGroup.addFilter(new DynamicFilter(key,
            new StaticFilterPrecondition(filterIsEnabled), getFilter, dependentFilterKeys));
          return filterGroupBuilder;
        }
      }
    },

    build: () => {
      return filterGroup;
    }
  };
  return filterGroupBuilder;
};

const buildFilterCollection = () => {
  const res = new FilterCollection();
  const builder = {
    addFilterGroup: (filterGroup) => {
      res.addFilterGroup(filterGroup);
      return builder;
    },

    build: () => {
      res.finishCreation();
      return res;
    }
  };
  return builder;
};

module.exports = {buildFilterCollection, buildFilterGroup};
