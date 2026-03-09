const ALLOWED_STEP_ACTIONS = [
  'scroll',
  'announce',
  'read_title',
  'read_selection',
  'read_focused',
  'read_heading',
  'focus_element',
  'click_element',
  'fill_text',
  'describe_page',
  'wait_for_user_input',
  'move_heading'
];

// CI: non-functional change to trigger the Docker publish workflow.
const baseSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Navable Backend API',
    version: '0.1.0',
    description:
      'Local backend API for the Navable browser extension (page snapshot summarization + suggested actions).'
  },
  tags: [
    { name: 'Health', description: 'Service status endpoints' },
    { name: 'Settings', description: 'Runtime backend settings' },
    { name: 'Summarization', description: 'Page summarization endpoints' },
    { name: 'Speech', description: 'Voice transcription endpoints' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                examples: { ok: { value: { ok: true } } }
              }
            }
          }
        }
      }
    },
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get runtime settings',
        responses: {
          200: {
            description: 'Current settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Settings' }
              }
            }
          }
        }
      },
      put: {
        tags: ['Settings'],
        summary: 'Update runtime settings',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateSettingsRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Updated settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Settings' }
              }
            }
          },
          400: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      delete: {
        tags: ['Settings'],
        summary: 'Reset runtime settings to defaults',
        responses: {
          200: {
            description: 'Default settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Settings' }
              }
            }
          }
        }
      }
    },
    '/api/summarize': {
      post: {
        tags: ['Summarization'],
        summary: 'Summarize a page snapshot',
        description:
          'Accepts a structured page snapshot and returns a friendly summary, next suggestions, and an optional tool plan.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SummarizeRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Summarization result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SummarizeResponse' }
              }
            }
          },
          400: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/transcribe': {
      post: {
        tags: ['Speech'],
        summary: 'Transcribe a short voice command',
        description:
          'Accepts a short base64-encoded audio clip and returns the transcript text plus detected input language.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TranscribeRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Transcription result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TranscribeResponse' }
              }
            }
          },
          400: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          503: {
            description: 'Transcription backend unavailable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/translate-messages': {
      post: {
        tags: ['Speech'],
        summary: 'Translate Navable UI messages',
        description:
          'Accepts a message catalog and returns the same keys translated into the requested language.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TranslateMessagesRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Translated message catalog',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TranslateMessagesResponse' }
              }
            }
          },
          400: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } }
      },
      ErrorResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['error'],
        properties: { error: { type: 'string' } }
      },
      PageStructure: {
        type: 'object',
        description:
          'Structured snapshot of the page produced by the extension content script.',
        additionalProperties: true
      },
      Step: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ALLOWED_STEP_ACTIONS },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'top', 'bottom', 'next', 'prev']
          },
          target: { type: 'string', enum: ['heading', 'link', 'button', 'input'] },
          label: { type: 'string' },
          n: { type: 'number' }
        }
      },
      Plan: {
        type: 'object',
        additionalProperties: false,
        required: ['steps'],
        properties: {
          steps: { type: 'array', items: { $ref: '#/components/schemas/Step' } }
        }
      },
      SummarizeRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['pageStructure'],
        properties: {
          command: {
            type: 'string',
            description: 'Optional user command (any language).'
          },
          outputLanguage: {
            type: 'string',
            description: 'Preferred language for Navable-authored summary output.'
          },
          pageStructure: { $ref: '#/components/schemas/PageStructure' }
        }
      },
      SummarizeResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['friendlySummary', 'suggestions', 'plan'],
        properties: {
          friendlySummary: { type: 'string' },
          suggestions: { type: 'array', items: { type: 'string' } },
          plan: { $ref: '#/components/schemas/Plan' }
        }
      },
      TranscribeRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['audioBase64'],
        properties: {
          audioBase64: {
            type: 'string',
            description: 'Base64-encoded short audio clip (for example webm/opus).'
          },
          mimeType: {
            type: 'string',
            description: 'Optional MIME type for the uploaded audio clip.'
          }
        }
      },
      TranscribeResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'language'],
        properties: {
          text: { type: 'string' },
          language: { type: 'string' }
        }
      },
      TranslateMessagesRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'messages'],
        properties: {
          language: {
            type: 'string',
            description: 'Target language code for the translated output.'
          },
          messages: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Flat message catalog to translate.'
          }
        }
      },
      TranslateMessagesResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'messages'],
        properties: {
          language: { type: 'string' },
          messages: {
            type: 'object',
            additionalProperties: { type: 'string' }
          }
        }
      },
      Settings: {
        type: 'object',
        additionalProperties: false,
        required: ['aiEnabled', 'model', 'transcriptionModel'],
        properties: {
          aiEnabled: {
            type: 'boolean',
            description:
              'When false, /api/summarize skips OpenAI and uses local fallback.'
          },
          model: { type: 'string', description: 'OpenAI model ID for summaries.' },
          transcriptionModel: { type: 'string', description: 'OpenAI model ID for voice transcription.' }
        }
      },
      UpdateSettingsRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          aiEnabled: { type: 'boolean' },
          model: { type: 'string' },
          transcriptionModel: { type: 'string' }
        }
      }
    }
  }
};

function getRequestServerUrl(req) {
  const host = req?.get?.('host');
  if (!host) return null;

  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string' && forwardedProto.trim()
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'http';
  return `${protocol}://${host}`;
}

export function getOpenApiSpec(req) {
  const serverUrl =
    getRequestServerUrl(req) || `http://localhost:${process.env.PORT || 3000}`;
  return { ...baseSpec, servers: [{ url: serverUrl }] };
}
