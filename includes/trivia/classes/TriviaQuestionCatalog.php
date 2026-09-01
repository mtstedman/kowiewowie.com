<?php

declare(strict_types=1);

namespace Wowie\Api\Trivia;

use Wowie\Api\ApiException;

final class TriviaQuestionCatalog
{
    public const MIN_PROMPTS = 1;
    public const MAX_ROOM_PROMPTS = 6;

    /**
     * @return list<array{question: string, correct_answer: string, choices: list<string>, explanation: ?string, answer_shape: array<string, mixed>, image_url: ?string}>
     */
    public function resolve(mixed $value, int $minimumPrompts = self::MIN_PROMPTS): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'validation_error', 'prompts must be a list of trivia prompt objects.');
        }
        $minimumPrompts = max(self::MIN_PROMPTS, $minimumPrompts);
        if (count($value) < $minimumPrompts) {
            throw new ApiException(422, 'validation_error', sprintf(
                'prompts must contain at least %d entries for the trivia game.',
                $minimumPrompts,
            ));
        }

        return array_map(fn (mixed $prompt): array => $this->normalizePrompt($prompt), $value);
    }

    /** @return array{question: string, correct_answer: string, choices: list<string>, explanation: ?string, answer_shape: array<string, mixed>, image_url: ?string} */
    private function normalizePrompt(mixed $value): array
    {
        if (!is_array($value)) {
            throw new ApiException(422, 'validation_error', 'Each trivia prompt must be an object.');
        }
        $question = trim((string) ($value['question'] ?? ''));
        $correctAnswer = trim((string) ($value['correct_answer'] ?? $value['answer'] ?? ''));
        if ($question === '' || mb_strlen($question) > 300) {
            throw new ApiException(422, 'validation_error', 'Each prompt question must contain 1 to 300 characters.');
        }
        if ($correctAnswer === '' || mb_strlen($correctAnswer) > 200) {
            throw new ApiException(422, 'validation_error', 'Each prompt correct_answer must contain 1 to 200 characters.');
        }
        $choices = $value['choices'] ?? null;
        if (!is_array($choices) || !array_is_list($choices)) {
            throw new ApiException(422, 'validation_error', 'Prompt choices must be a list of answer strings.');
        }
        $choices = array_values(array_map(static fn (mixed $choice): string => trim((string) $choice), $choices));
        $choices = array_values(array_filter($choices, static fn (string $choice): bool => $choice !== ''));
        if (!in_array($correctAnswer, $choices, true)) {
            $choices[] = $correctAnswer;
        }
        if (count($choices) < 2) {
            throw new ApiException(422, 'validation_error', 'Each prompt must provide at least two answer choices.');
        }

        $answerShape = $value['answer_shape'] ?? ['type' => 'single_choice'];
        if (!is_array($answerShape)) {
            throw new ApiException(422, 'validation_error', 'Prompt answer_shape must be an object when provided.');
        }
        $answerShapeType = trim((string) ($answerShape['type'] ?? 'single_choice'));
        if (!in_array($answerShapeType, ['single_choice', 'multi_select'], true)) {
            throw new ApiException(422, 'validation_error', 'Prompt answer_shape.type must be single_choice or multi_select.');
        }
        $answerShape['type'] = $answerShapeType;
        if (isset($value['correct_answers'])) {
            if (!is_array($value['correct_answers']) || !array_is_list($value['correct_answers'])) {
                throw new ApiException(422, 'validation_error', 'Prompt correct_answers must be a list of answer strings.');
            }
            $answerShape['correct_answers'] = array_values(array_filter(
                array_map(static fn (mixed $answer): string => trim((string) $answer), $value['correct_answers']),
                static fn (string $answer): bool => $answer !== ''
            ));
        }
        $imageUrl = isset($value['image_url']) ? trim((string) $value['image_url']) : null;
        if ($imageUrl === '') {
            $imageUrl = null;
        }
        if ($imageUrl !== null && mb_strlen($imageUrl) > 300) {
            throw new ApiException(422, 'validation_error', 'Prompt image_url must contain 300 characters or fewer.');
        }

        return [
            'question' => $question,
            'correct_answer' => $correctAnswer,
            'choices' => $choices,
            'explanation' => isset($value['explanation']) ? trim((string) $value['explanation']) : null,
            'answer_shape' => $answerShape,
            'image_url' => $imageUrl,
        ];
    }
}
