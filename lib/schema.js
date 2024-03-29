import mongoose from "mongoose";
import { GraphQLSchema } from "graphql/type";
import { formatError } from "graphql-server-express";

import {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLID,
  GraphQLBoolean,
  GraphQLList
} from "graphql";

const ImageInputCustomType = new GraphQLInputObjectType({
  name: "ImageInput",
  fields: {
    public_id: { type: GraphQLString },
    url: { type: GraphQLString }
  }
});

const ImageOutputCustomType = new GraphQLObjectType({
  name: "Image",
  fields: {
    public_id: { type: GraphQLString },
    url: { type: GraphQLString }
  }
});

const INPUT_TYPE_MAP = {
  ObjectId: GraphQLID,
  String: GraphQLString,
  Boolean: GraphQLBoolean,
  Number: GraphQLID,
  Image: ImageInputCustomType
};

const OUTPUT_TYPE_MAP = {
  ObjectId: GraphQLID,
  String: GraphQLString,
  Boolean: GraphQLBoolean,
  Number: GraphQLID,
  Image: ImageOutputCustomType
};

const PERMISSION_ACTION_MAP = {
  get: "canView",
  list: "canView",
  create: "canCreate",
  update: "canUpdate",
  remove: "canRemove"
};

const permissionDenied = Error("Permission Denied");
export const errorObj = obj => {
  return new Error(JSON.stringify(obj));
};

const can = (modelName, action, permissions) => {
  const permission = permissions[modelName];

  if (permission) return permission[action];
  return true;
};

const getGQLField = (field, ObjectTypes, isOutputField) => {
  const typeMap = isOutputField ? OUTPUT_TYPE_MAP : INPUT_TYPE_MAP;
  if (Array.isArray(field)) {
    const keyType = field[0].type.name;
    const keyRef = field[0].ref;
    const gqlType = typeMap[keyType];

    if (keyRef && ObjectTypes && ObjectTypes[keyRef]) {
      return { type: new GraphQLList(ObjectTypes[keyRef]) };
    }

    return { type: new GraphQLList(gqlType) };
  }

  const keyType = field.type.name || field.type;
  const gqlType = typeMap[keyType];
  return { type: gqlType };
};

const getGQLInputField = (field, ObjectTypes) =>
  getGQLField(field, ObjectTypes);
const getGQLOutputField = (field, ObjectTypes) =>
  getGQLField(field, ObjectTypes, true);

// change mongose _id from string to mongoose.Types.ObjectId
const sanitizeArgs = args => {
  const { id, ...restOfArgs } = args;
  let sanitizedArgs = {
    ...restOfArgs
  };

  if (id) sanitizedArgs["_id"] = mongoose.Types.ObjectId(id);
  return sanitizedArgs;
};

const getAllPossibleArgsForGetQuery = modelFields => {
  let args = { id: { type: GraphQLID } };

  Object.keys(modelFields).forEach(key => {
    args[key] = getGQLInputField(modelFields[key]);
  });

  return args;
};

const getAllPossibleArgsForListQuery = modelFields => {
  return {
    ...getAllPossibleArgsForGetQuery(modelFields),
    pageNumber: { type: GraphQLInt },
    pageSize: { type: GraphQLInt }
  };
};

const getAllPossibleArgsForCreateMutation = modelFields => {
  let args = {};

  Object.keys(modelFields).forEach(key => {
    args[key] = getGQLInputField(modelFields[key]);
  });

  return args;
};

const getAllPossibleArgsForUpdateMutation = modelFields =>
  getAllPossibleArgsForGetQuery(modelFields);
const getAllPossibleArgsForRemoveMutation = modelFields =>
  getAllPossibleArgsForGetQuery(modelFields);

// Object types and fields for dataRequirements
function generateObjectTypes(dataRequirements) {
  // Generate GraphQL Object Types for all Mongo Models
  let objectTypes = {};
  Object.keys(dataRequirements).map(modelName => {
    const modelFields = dataRequirements[modelName].fields;

    // Map Mongo Fields Types to GraphQL Types
    let gqlFields = { id: { type: GraphQLID } };
    Object.keys(modelFields).forEach(k => {
      const field = modelFields[k];
      gqlFields[k] = getGQLOutputField(field, objectTypes);
    });

    // Create GraphQL Schema Objects
    var gqlObjectType = new GraphQLObjectType({
      name: `${modelName}Type`,
      fields: gqlFields
    });

    objectTypes[modelName] = gqlObjectType;
  });

  return objectTypes;
}

function generateGetQueries(ObjectTypes, modelObjects) {
  let getQueries = {};

  Object.keys(ObjectTypes).forEach(objectName => {
    const modelObject = modelObjects[objectName];
    const queryType = "get";
    const queryName = objectName.toLowerCase();

    getQueries[queryName] = {
      type: ObjectTypes[objectName],
      args: getAllPossibleArgsForGetQuery(modelObject.fields),
      resolve: async function(_, { ...args }, { permissions }) {
        return can(objectName, queryType, permissions)
          ? await modelObject.model
              .findOne(sanitizeArgs(args))
              .populate("sections topics")
          : formatError(errorObj({ _error: "Permission denied" }));
      }
    };
  });

  return getQueries;
}

function generateListQueries(ObjectTypes, modelObjects) {
  let listQueries = {};

  Object.keys(ObjectTypes).forEach(objectName => {
    const modelObject = modelObjects[objectName];
    const queryType = "list";
    const queryName = `${queryType}${objectName}s`;

    listQueries[queryName] = {
      type: new GraphQLList(ObjectTypes[objectName]),
      args: getAllPossibleArgsForListQuery(modelObject.fields),
      resolve: async function(
        _,
        { pageSize, pageNumber, ...args },
        { permissions }
      ) {
        return can(objectName, queryType, permissions)
          ? await modelObject.model
              .find(sanitizeArgs(args))
              .populate("sections topics")
          : formatError(errorObj({ _error: "Permission denied" }));
      }
    };
  });

  return listQueries;
}

function generateCreateMutations(ObjectTypes, modelObjects) {
  let createMutations = {};

  Object.keys(ObjectTypes).forEach(objectName => {
    const modelObject = modelObjects[objectName];
    const mutationType = "create";
    const mutationName = `${mutationType}${objectName}`;

    createMutations[mutationName] = {
      type: ObjectTypes[objectName],
      args: getAllPossibleArgsForCreateMutation(modelObject.fields),
      resolve: async function(_, { ...args }, context) {
        const { beforeCreate } = modelObjects[objectName];
        const finalObj = beforeCreate ? beforeCreate(args) : args;

        return can(objectName, mutationType, context)
          ? await modelObject.model(finalObj).save()
          : formatError(errorObj({ _error: "Permission denied" }));
      }
    };
  });

  return createMutations;
}

function generateUpdateMutations(ObjectTypes, modelObjects) {
  let updateMutations = {};

  Object.keys(ObjectTypes).forEach(objectName => {
    const modelObject = modelObjects[objectName];
    const mutationType = "update";
    const mutationName = `${mutationType}${objectName}`;

    updateMutations[mutationName] = {
      type: ObjectTypes[objectName],
      args: getAllPossibleArgsForUpdateMutation(modelObject.fields),
      resolve: async function(_, { id, ...args }, { permissions }) {
        console.log(id, args);
        return can(objectName, mutationType, permissions)
          ? await modelObject.model.findOneAndUpdate({ _id: id }, args, {
              new: true
            })
          : formatError(errorObj({ _error: "Permission denied" }));
      }
    };
  });

  return updateMutations;
}

function generateRemoveMutations(ObjectTypes, modelObjects) {
  let removeMutations = {};

  Object.keys(ObjectTypes).forEach(objectName => {
    const modelObject = modelObjects[objectName];
    const mutationType = "remove";
    const mutationName = `${mutationType}${objectName}`;

    removeMutations[mutationName] = {
      type: ObjectTypes[objectName],
      args: getAllPossibleArgsForRemoveMutation(modelObject.fields),
      resolve: async function(_, { ...args }) {
        return can(objectName, mutationType, permissions)
          ? await modelObject.model.remove(args)
          : formatError(errorObj({ _error: "Permission denied" }));
      }
    };
  });

  return removeMutations;
}

export function autoGenerateGraphQLSchema(dataRequirements, modelObjects) {
  // Generate GraphQL Object Types for all Mongo Models
  const gqlObjectTypes = generateObjectTypes(dataRequirements);

  // Generate queries
  const getQueries = generateGetQueries(gqlObjectTypes, modelObjects);
  const listQueries = generateListQueries(gqlObjectTypes, modelObjects);
  const allQueries = { ...getQueries, ...listQueries };

  const rootQuery = new GraphQLObjectType({
    name: "RootQuery",
    fields: allQueries
  });

  // Generate mutations
  const createMutation = generateCreateMutations(gqlObjectTypes, modelObjects);
  const updateMutations = generateUpdateMutations(gqlObjectTypes, modelObjects);
  const removeMutations = generateRemoveMutations(gqlObjectTypes, modelObjects);
  const allMutations = {
    ...createMutation,
    ...updateMutations,
    ...removeMutations
  };

  const rootMutation = new GraphQLObjectType({
    name: "RootMutation",
    fields: allMutations
  });

  return new GraphQLSchema({
    query: rootQuery,
    mutation: rootMutation
  });
}
