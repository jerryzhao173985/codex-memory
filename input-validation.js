"use strict";

function defaultErrorFactory(message) {
  return new Error(message);
}

function getErrorFactory(options = {}) {
  return typeof options.errorFactory === "function"
    ? options.errorFactory
    : defaultErrorFactory;
}

function getIntegerConstraintLabel(options = {}) {
  if (options.nonNegative) return "a non-negative integer";
  if (options.positive) return "a positive integer";
  return "an integer";
}

function readRequiredOptionValue(argv, index, flagName, options = {}) {
  const value = argv[index + 1];
  if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
    throw getErrorFactory(options)(`${flagName} value is required`);
  }
  return value;
}

function readValidatedInteger(rawValue, options = {}) {
  const errorFactory = getErrorFactory(options);
  const label = options.label || "value";
  if (rawValue === undefined) return undefined;
  if (rawValue === null) throw errorFactory(`${label} must be ${getIntegerConstraintLabel(options)}`);

  const text = typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
  if (!text) throw errorFactory(`${label} must be ${getIntegerConstraintLabel(options)}`);

  const number = Number(text);
  if (!Number.isInteger(number)) throw errorFactory(`${label} must be an integer`);
  if (options.positive && number <= 0) throw errorFactory(`${label} must be a positive integer`);
  if (options.nonNegative && number < 0) throw errorFactory(`${label} must be a non-negative integer`);
  return number;
}

function readRequiredIntegerOptionValue(argv, index, flagName, options = {}) {
  const value = readRequiredOptionValue(argv, index, flagName, options);
  return readValidatedInteger(value, { ...options, label: flagName });
}

function readPositiveIntegerOptionValue(argv, index, flagName, options = {}) {
  const value = readRequiredOptionValue(argv, index, flagName, options);
  return readValidatedInteger(value, { ...options, label: flagName, positive: true });
}

function readNonNegativeIntegerOptionValue(argv, index, flagName, options = {}) {
  const value = readRequiredOptionValue(argv, index, flagName, options);
  return readValidatedInteger(value, { ...options, label: flagName, nonNegative: true });
}

function getFirstPresentQueryValue(searchParams, names = []) {
  for (const name of names) {
    if (typeof name === "string" && name && searchParams.has(name)) {
      return searchParams.get(name);
    }
  }
  return undefined;
}

function readOptionalQueryInteger(searchParams, names = [], options = {}) {
  return readValidatedInteger(
    getFirstPresentQueryValue(searchParams, names),
    {
      ...options,
      label: options.label || names[0] || "value",
    }
  );
}

function readOptionalBodyInteger(data, names = [], options = {}) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data, name)) {
      return readValidatedInteger(data[name], {
        ...options,
        label: options.label || names[0] || "value",
      });
    }
  }
  return undefined;
}

function createArgReaders(options = {}) {
  const boundOptions = {
    errorFactory: getErrorFactory(options),
  };
  return {
    readRequiredOptionValue(argv, index, flagName) {
      return readRequiredOptionValue(argv, index, flagName, boundOptions);
    },
    readRequiredIntegerOptionValue(argv, index, flagName) {
      return readRequiredIntegerOptionValue(argv, index, flagName, boundOptions);
    },
    readPositiveIntegerOptionValue(argv, index, flagName) {
      return readPositiveIntegerOptionValue(argv, index, flagName, boundOptions);
    },
    readNonNegativeIntegerOptionValue(argv, index, flagName) {
      return readNonNegativeIntegerOptionValue(argv, index, flagName, boundOptions);
    },
  };
}

module.exports = {
  createArgReaders,
  readRequiredOptionValue,
  readRequiredIntegerOptionValue,
  readPositiveIntegerOptionValue,
  readNonNegativeIntegerOptionValue,
  readValidatedInteger,
  readOptionalQueryInteger,
  readOptionalBodyInteger,
};
